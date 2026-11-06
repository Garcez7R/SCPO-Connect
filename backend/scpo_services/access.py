import asyncio
import hmac
import logging
import os
import uuid
from collections.abc import Collection
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

import httpx
from cryptography.exceptions import InvalidTag
from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    func,
    select,
)
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Mapped, Session, mapped_column

from .common import (
    Base,
    DemoPrincipal,
    database_session,
    emit_audit_event,
    get_engine,
    maintenance_mode_blocks_request,
    register_audit_outbox_status_route,
    require_service_token,
    verify_database_migrated,
)
from .security import (
    SESSION_COOKIE,
    SESSION_TTL_SECONDS,
    decrypt_mfa_secret,
    encrypt_mfa_secret,
    hash_password,
    issue_session,
    new_totp_secret,
    read_session,
    totp_uri,
    verify_password,
    verify_totp,
)

MODULES = {
    "patients", "nursing", "pharmacy", "xray", "physician", "social", "nutrition", "hygiene",
    "reception", "therapy", "psychology", "maintenance", "management", "admin", "oversight",
    "laundry", "warehouse",
}
GLOBAL_MODULES = MODULES - {"oversight"}
ACTIONS = {"consultar", "criar", "alterar", "excluir", "administrar"}
INITIAL_PASSWORD = "0000"
SYSTEM_SUPERADMIN_USERNAME = os.getenv("SCPO_SUPERADMIN_USERNAME", "rgarcez").strip().lower()
LOCKOUT_MINUTES = 1


class AppUser(Base):
    __tablename__ = "app_users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    username: Mapped[str] = mapped_column(String(80), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(80), nullable=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    modules: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    permissions: Mapped[dict[str, list[str]]] = mapped_column(JSON, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    must_change_password: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    mfa_secret_encrypted: Mapped[str | None] = mapped_column(String(255), nullable=True)
    mfa_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_superuser: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    failed_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    session_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class SystemModuleSettings(Base):
    __tablename__ = "system_module_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    module_enabled: Mapped[dict[str, bool]] = mapped_column(JSON, nullable=False)
    maintenance_mode: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_by_id: Mapped[str] = mapped_column(String(36), nullable=False)
    updated_by_name: Mapped[str] = mapped_column(String(120), nullable=False)


class AppAnnouncement(Base):
    __tablename__ = "app_announcements"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    summary: Mapped[str | None] = mapped_column(String(500), nullable=True)
    content: Mapped[str | None] = mapped_column(String(5000), nullable=True)
    kind: Mapped[str] = mapped_column(String(32), nullable=False, default="notice")
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by_id: Mapped[str] = mapped_column(String(36), nullable=False)
    created_by_name: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class SystemUserActivity(Base):
    __tablename__ = "system_user_activity"
    __table_args__ = (
        Index("ix_system_user_activity_last_activity_at", "last_activity_at"),
    )

    user_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("app_users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    last_activity_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class PhysicianProfileDeletionOutbox(Base):
    __tablename__ = "physician_profile_deletion_outbox"
    __table_args__ = (
        Index("ix_physician_profile_deletion_outbox_next_attempt", "next_attempt_at"),
    )

    user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    actor_id: Mapped[str] = mapped_column(String(36), nullable=False)
    actor_name: Mapped[str] = mapped_column(String(100), nullable=False)
    actor_role: Mapped[str] = mapped_column(String(40), nullable=False)
    requested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_error: Mapped[str] = mapped_column(String(500), nullable=False, default="")


def get_access_db():
    yield from database_session("access")


def _system_module_settings(db: Session) -> SystemModuleSettings:
    settings = db.get(SystemModuleSettings, 1)
    if settings is None:
        raise HTTPException(status_code=503, detail="Configurações globais não foram inicializadas")
    if not isinstance(settings.module_enabled, dict) or any(
        module not in MODULES or not isinstance(enabled, bool)
        for module, enabled in settings.module_enabled.items()
    ):
        raise HTTPException(status_code=503, detail="Configurações globais inválidas")
    return settings


def _module_settings_response(
    settings: SystemModuleSettings,
    *,
    include_audit_metadata: bool = False,
) -> dict[str, object]:
    result: dict[str, object] = {
        "module_enabled": {
            module: settings.module_enabled.get(module, True)
            for module in sorted(GLOBAL_MODULES)
        },
        "maintenance_mode": settings.maintenance_mode,
    }
    if include_audit_metadata:
        result.update(
            updated_at=settings.updated_at.isoformat(),
            updated_by_name=settings.updated_by_name,
        )
    return result


@asynccontextmanager
async def lifespan(_: FastAPI):
    verify_database_migrated("access")
    from .common import audit_outbox_lifespan

    async with audit_outbox_lifespan("access"):
        task = asyncio.create_task(_run_physician_profile_deletion_dispatcher())
        try:
            yield
        finally:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass


app = FastAPI(
    title="SCPO Connect · Identidade e Acesso",
    version="1.1.0",
    description="Contas locais individuais, MFA e permissões por módulo.",
    lifespan=lifespan,
)
register_audit_outbox_status_route(app, "access")
_logger = logging.getLogger("scpo.access")


def dispatch_pending_physician_profile_deletions(limit: int = 25) -> int:
    service_token = os.getenv("SCPO_SERVICE_TOKEN", "")
    nursing_url = os.getenv("SCPO_NURSING_API_URL", "http://nursing:8000").rstrip("/")
    now = datetime.now(UTC)
    completed = 0
    with Session(get_engine("access")) as db:
        pending = db.scalars(
            select(PhysicianProfileDeletionOutbox)
            .where(PhysicianProfileDeletionOutbox.next_attempt_at <= now)
            .order_by(PhysicianProfileDeletionOutbox.requested_at)
            .limit(limit)
        ).all()
        for deletion in pending:
            try:
                if not service_token:
                    raise RuntimeError("Token interno de serviços não configurado")
                response = httpx.delete(
                    f"{nursing_url}/internal/v1/physicians/profiles/{deletion.user_id}",
                    headers={"X-Service-Token": service_token},
                    timeout=3.0,
                )
                response.raise_for_status()
            except (httpx.HTTPError, RuntimeError) as exc:
                deletion.attempts += 1
                delay = min(3600, 2 ** min(deletion.attempts, 11))
                deletion.next_attempt_at = datetime.now(UTC) + timedelta(seconds=delay)
                deletion.last_error = str(exc)[:500]
                _logger.error(
                    "Physician profile deletion deferred (user %s, attempt %s): %s",
                    deletion.user_id,
                    deletion.attempts,
                    exc,
                )
                continue
            user = db.get(AppUser, deletion.user_id)
            if user is not None:
                principal = DemoPrincipal(
                    user_id=deletion.actor_id,
                    username="",
                    actor_name=deletion.actor_name,
                    role=deletion.actor_role,
                    modules=[],
                    permissions={},
                )
                emit_audit_event(
                    principal, "management", "user_deleted", user.id, db=db, service="access"
                )
                db.delete(user)
            db.delete(deletion)
            completed += 1
        db.commit()
    return completed


async def _run_physician_profile_deletion_dispatcher() -> None:
    while True:
        try:
            await asyncio.to_thread(dispatch_pending_physician_profile_deletions)
        except SQLAlchemyError:
            _logger.exception("Physician profile deletion dispatcher database error")
        await asyncio.sleep(5)


def _ensure_not_deletion_pending(db: Session, user_id: str) -> None:
    if db.get(PhysicianProfileDeletionOutbox, user_id) is not None:
        raise HTTPException(status_code=409, detail="A exclusão desta conta está em andamento")


class BootstrapPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str = Field(min_length=3, max_length=80, pattern=r"^[A-Za-z0-9._@-]+$")
    name: str = Field(min_length=2, max_length=120)
    password: str = Field(min_length=12, max_length=256)


class LoginPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=256)
    totp_code: str | None = Field(default=None, max_length=6)


class PasswordChangePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    current_password: str | None = Field(default=None, min_length=1, max_length=256)
    new_password: str = Field(min_length=12, max_length=256)


class ProfileUpdatePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    display_name: str = Field(min_length=1, max_length=80)

    @field_validator("display_name")
    @classmethod
    def validate_display_name(cls, value: str) -> str:
        clean = value.strip()
        if not clean:
            raise ValueError("Informe um nome de exibição")
        return clean


class ResetAllCredentialsPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    current_password: str = Field(min_length=1, max_length=256)
    confirmation: str = Field(min_length=1, max_length=80)


class TotpPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str = Field(pattern=r"^\d{6}$")


class UserCreatePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str = Field(min_length=3, max_length=80, pattern=r"^[A-Za-z0-9._@-]+$")
    name: str = Field(min_length=2, max_length=120)
    modules: list[str] = Field(min_length=1, max_length=len(MODULES))
    permissions: dict[str, list[str]] | None = None

    @field_validator("modules")
    @classmethod
    def validate_modules(cls, values: list[str]) -> list[str]:
        if len(set(values)) != len(values) or set(values) - MODULES:
            raise ValueError("Módulo inválido ou repetido")
        return values


class UserUpdatePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(default=None, min_length=2, max_length=120)
    modules: list[str] | None = Field(default=None, min_length=1, max_length=len(MODULES))
    permissions: dict[str, list[str]] | None = None
    active: bool | None = None


class SystemModuleSettingsPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    module_enabled: dict[str, bool] = Field(default_factory=dict)
    maintenance_mode: bool | None = None

    @field_validator("module_enabled")
    @classmethod
    def validate_module_names(cls, values: dict[str, bool]) -> dict[str, bool]:
        if set(values) - GLOBAL_MODULES:
            raise ValueError("Módulo inválido")
        return values

    @model_validator(mode="after")
    def validate_settings_present(self) -> "SystemModuleSettingsPayload":
        if not self.module_enabled and self.maintenance_mode is None:
            raise ValueError("Informe ao menos uma configuração")


class AppAnnouncementPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=3, max_length=160)
    url: str | None = Field(default=None, max_length=2048)
    summary: str | None = Field(default=None, max_length=500)
    content: str | None = Field(default=None, max_length=5000)
    kind: Literal["notice", "information", "procedure"] = "notice"
    published_at: datetime | None = None
    expires_at: datetime | None = None
    active: bool = True

    @field_validator("url")
    @classmethod
    def validate_http_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        url = value.strip()
        if not url.startswith(("http://", "https://")):
            raise ValueError("Informe uma URL HTTPS ou HTTP")
        return url

    @model_validator(mode="after")
    def validate_link_or_content(self) -> "AppAnnouncementPayload":
        if not self.url and not (self.content and self.content.strip()):
            raise ValueError("Informe uma URL ou o texto do informativo")
        if self.published_at is not None and self.published_at.utcoffset() is None:
            raise ValueError("Informe o início da exibição com fuso horário")
        if self.expires_at is not None and self.expires_at.utcoffset() is None:
            raise ValueError("Informe o encerramento com fuso horário")
        if self.published_at is not None and self.expires_at is not None and self.expires_at <= self.published_at:
            raise ValueError("O encerramento deve ser posterior ao início da exibição")
        return self


class AuthEventPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    token: str = Field(min_length=20, max_length=2048)


class AuditEventPayload(BaseModel):
    actor_name: str = Field(min_length=1, max_length=100)
    actor_role: str = Field(min_length=1, max_length=40)
    action: str = Field(min_length=1, max_length=60)
    module: str = Field(min_length=1, max_length=40)
    target_id: str = Field(min_length=1, max_length=40)


def _new_user(username: str, name: str, modules: list[str], permissions: dict[str, list[str]], password: str = INITIAL_PASSWORD) -> AppUser:
    return AppUser(
        id=str(uuid.uuid4()),
        username=username.strip().lower(),
        name=name.strip(),
        password_hash=hash_password(password),
        modules=modules,
        permissions=permissions,
        active=True,
        must_change_password=True,
        mfa_secret_encrypted=None,
        mfa_enabled=False,
        is_superuser=False,
        failed_attempts=0,
        session_version=1,
        created_at=datetime.now(UTC),
    )


def _all_permissions() -> dict[str, list[str]]:
    return {module: ["consultar", "criar", "alterar", "excluir", "administrar"] for module in sorted(MODULES)}


def _validate_permissions(modules: list[str], permissions: dict[str, list[str]] | None) -> dict[str, list[str]]:
    if "management" in modules or "admin" in modules:
        return _all_permissions()
    if permissions is None:
        return {
            module: (
                ["consultar", "criar", "alterar", "administrar"]
                if module == "admin"
                else ["consultar"]
                if module == "oversight"
                else ["consultar", "criar", "alterar"]
            )
            for module in modules
        }
    if set(permissions) - set(modules):
        raise HTTPException(status_code=422, detail="Permissão configurada para módulo sem acesso")
    clean: dict[str, list[str]] = {}
    for module in modules:
        actions = permissions.get(module, [])
        if len(actions) != len(set(actions)) or set(actions) - ACTIONS:
            raise HTTPException(status_code=422, detail="Ação inválida ou repetida")
        clean[module] = actions
    return clean


def _current_user(
    request: Request,
    db: Session,
    allowed_stages: Collection[str] = frozenset({"active"}),
) -> tuple[AppUser, dict[str, object]]:
    token = request.cookies.get(SESSION_COOKIE)
    claims = read_session(token) if token else None
    if not claims or claims.get("stage") not in allowed_stages:
        raise HTTPException(status_code=401, detail="Sessão necessária")
    user = db.get(AppUser, str(claims["sub"]))
    if user is None or not user.active or claims.get("sv") != user.session_version:
        raise HTTPException(status_code=401, detail="Sessão revogada")
    locked_until = user.locked_until
    if locked_until and locked_until.tzinfo is None:
        locked_until = locked_until.replace(tzinfo=UTC)
    if locked_until and locked_until > datetime.now(UTC):
        raise HTTPException(status_code=429, detail="Acesso temporariamente bloqueado")
    if not user.is_superuser and request.method.upper() in {"POST", "PUT", "PATCH", "DELETE"}:
        settings = _system_module_settings(db)
        if maintenance_mode_blocks_request(
            request.method,
            request.url.path,
            settings.maintenance_mode,
            user.is_superuser,
        ):
            raise HTTPException(
                status_code=503,
                detail="O aplicativo está em modo de manutenção; alterações estão temporariamente bloqueadas",
            )
    return user, claims


def _require_account_admin(request: Request, db: Session) -> tuple[AppUser, DemoPrincipal]:
    user, _ = _current_user(request, db)
    if not user.is_superuser and not _system_module_settings(db).module_enabled.get("admin", True):
        raise HTTPException(status_code=403, detail="O módulo Administração está temporariamente desativado")
    is_app_admin = "admin" in user.modules and "administrar" in user.permissions.get("admin", [])
    if not user.is_superuser and not is_app_admin:
        raise HTTPException(status_code=403, detail="Acesso restrito à Administração do aplicativo")
    return user, _audit_principal(user)


def _require_system_admin(request: Request, db: Session) -> tuple[AppUser, DemoPrincipal]:
    user, _ = _current_user(request, db)
    if not user.is_superuser:
        raise HTTPException(status_code=403, detail="Acesso não autorizado para esta operação")
    return user, _audit_principal(user)


def _audit_principal(user: AppUser) -> DemoPrincipal:
    return DemoPrincipal(
        user.id,
        user.username,
        user.display_name or user.name,
        "system_admin" if user.is_superuser else (
            "admin" if "admin" in user.modules else (user.modules[0] if user.modules else "")
        ),
        user.modules,
        user.permissions,
        is_superuser=user.is_superuser,
    )


def _prevent_superuser_changes(target: AppUser) -> None:
    if target.is_superuser:
        raise HTTPException(
            status_code=403,
            detail="Esta conta não pode ser alterada por esta operação",
        )


def _reset_credentials(user: AppUser) -> str:
    temporary_password = INITIAL_PASSWORD
    user.password_hash = hash_password(temporary_password)
    user.must_change_password = True
    user.session_version += 1
    user.failed_attempts = 0
    user.locked_until = None
    return temporary_password


def _reset_password(user: AppUser) -> str:
    temporary_password = INITIAL_PASSWORD
    user.password_hash = hash_password(temporary_password)
    user.must_change_password = True
    user.session_version += 1
    user.failed_attempts = 0
    user.locked_until = None
    return temporary_password


def _read_mfa_secret(encrypted_secret: str) -> str:
    try:
        return decrypt_mfa_secret(encrypted_secret)
    except InvalidTag as exc:
        _logger.exception("Stored MFA secret could not be decrypted")
        raise HTTPException(
            status_code=503,
            detail=(
                "O segredo MFA salvo não pôde ser descriptografado pela chave configurada. "
                "Restaure SCPO_MFA_ENCRYPTION_KEY do backup original da instalação."
            ),
        ) from exc


def _set_cookie(response: Response, user: AppUser, stage: str) -> int:
    token = issue_session(user.id, stage, user.session_version)
    claims = read_session(token)
    if claims is None:
        raise RuntimeError("Falha ao emitir sessão autenticada")
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=SESSION_TTL_SECONDS,
        httponly=True,
        secure=os.getenv("SCPO_COOKIE_SECURE", "true").lower() == "true",
        samesite="strict",
        path="/",
    )
    return int(claims["exp"])


def _user_response(user: AppUser, deletion_pending: bool = False) -> dict[str, object]:
    is_management = user.is_superuser or "management" in user.modules
    is_app_admin = "admin" in user.modules
    has_all_modules = is_management or is_app_admin
    modules = sorted(MODULES) if has_all_modules else user.modules
    permissions = _all_permissions() if has_all_modules else user.permissions
    role = "management" if is_management else "admin" if is_app_admin else (user.modules[0] if user.modules else "")
    return {
        "id": user.id,
        "username": user.username,
        "name": user.name,
        "display_name": user.display_name or user.name,
        "role": role,
        "modules": modules,
        "permissions": permissions,
        "active": user.active,
        "is_superuser": user.is_superuser,
        "must_change_password": user.must_change_password,
        "mfa_enabled": user.mfa_enabled,
        "deletion_pending": deletion_pending,
    }


async def record_audit_event(
    principal: DemoPrincipal,
    target_id: str,
    action: str,
    db: Session,
) -> None:
    emit_audit_event(principal, "management", action, target_id, db=db, service="access")


@app.get("/health")
def health() -> dict[str, str]:
    return {"service": "access", "status": "ok"}


@app.get("/api/v1/auth/status")
def auth_status(db: Annotated[Session, Depends(get_access_db)]) -> dict[str, bool]:
    exists = db.scalar(select(AppUser.id).limit(1)) is not None
    return {"bootstrap_required": not exists}


@app.post("/api/v1/auth/bootstrap", status_code=201)
def bootstrap_admin(
    payload: BootstrapPayload,
    response: Response,
    db: Annotated[Session, Depends(get_access_db)],
    x_bootstrap_token: Annotated[str | None, Header(alias="X-Bootstrap-Token")] = None,
) -> dict[str, object]:
    expected = os.getenv("SCPO_BOOTSTRAP_ADMIN_TOKEN", "")
    if not expected or not x_bootstrap_token or not hmac.compare_digest(expected, x_bootstrap_token):
        raise HTTPException(status_code=403, detail="Bootstrap não autorizado")
    if db.scalar(select(AppUser.id).limit(1)) is not None:
        raise HTTPException(status_code=409, detail="Bootstrap já concluído")
    user = _new_user(
        payload.username,
        payload.name,
        sorted(MODULES),
        _all_permissions(),
        payload.password,
    )
    user.is_superuser = user.username == SYSTEM_SUPERADMIN_USERNAME
    user.must_change_password = False
    db.add(user)
    db.commit()
    db.refresh(user)
    session_expires_at = _set_cookie(response, user, "mfa_setup")
    return {
        "user": _user_response(user),
        "must_change_password": False,
        "mfa_setup_required": True,
        "session_expires_at": session_expires_at,
    }


@app.post("/api/v1/auth/login")
def login(
    payload: LoginPayload,
    response: Response,
    db: Annotated[Session, Depends(get_access_db)],
) -> dict[str, object]:
    username = payload.username.strip().lower()
    user = db.scalar(select(AppUser).where(AppUser.username == username))
    # Run one scrypt even for unknown usernames to reduce timing-based enumeration.
    if user is None:
        verify_password(payload.password, "scrypt$32768$8$1$AA$AA")
        raise HTTPException(status_code=401, detail="Usuário ou senha inválidos")
    now = datetime.now(UTC)
    locked_until = user.locked_until
    if locked_until and locked_until.tzinfo is None:
        locked_until = locked_until.replace(tzinfo=UTC)
    if locked_until and locked_until > now:
        raise HTTPException(status_code=429, detail="Acesso temporariamente bloqueado")
    valid_password = verify_password(payload.password, user.password_hash)
    valid_mfa = False
    if valid_password and user.mfa_enabled and user.mfa_secret_encrypted and payload.totp_code:
        valid_mfa = verify_totp(_read_mfa_secret(user.mfa_secret_encrypted), payload.totp_code)
    elif valid_password and not user.mfa_enabled:
        valid_mfa = True
    if not user.active or not valid_password or not valid_mfa:
        user.failed_attempts += 1
        if user.failed_attempts >= 5:
            user.locked_until = now + timedelta(minutes=LOCKOUT_MINUTES)
            user.failed_attempts = 0
        db.commit()
        raise HTTPException(status_code=401, detail="Usuário, senha ou código inválidos")
    user.failed_attempts = 0
    user.locked_until = None
    db.commit()
    stage = "password_change" if user.must_change_password else ("mfa_setup" if not user.mfa_enabled else "active")
    session_expires_at = _set_cookie(response, user, stage)
    return {
        "user": _user_response(user),
        "must_change_password": user.must_change_password,
        "mfa_setup_required": not user.mfa_enabled and not user.must_change_password,
        "session_expires_at": session_expires_at,
    }


@app.post("/api/v1/auth/password")
async def change_password(
    payload: PasswordChangePayload,
    request: Request,
    response: Response,
    db: Annotated[Session, Depends(get_access_db)],
) -> dict[str, object]:
    user, claims = _current_user(request, db, {"password_change", "active"})
    if claims.get("stage") == "active":
        if not payload.current_password or not verify_password(payload.current_password, user.password_hash):
            raise HTTPException(status_code=401, detail="A senha atual está incorreta")
        if verify_password(payload.new_password, user.password_hash):
            raise HTTPException(status_code=422, detail="Escolha uma senha diferente da senha atual")
    if payload.new_password == INITIAL_PASSWORD:
        raise HTTPException(status_code=422, detail="Escolha uma senha diferente da senha inicial")
    principal = DemoPrincipal(
        user.id,
        user.username,
        user.display_name or user.name,
        "system_admin" if user.is_superuser else ("admin" if "admin" in user.modules else (user.modules[0] if user.modules else "")),
        user.modules,
        user.permissions,
        is_superuser=user.is_superuser,
    )
    await record_audit_event(principal, user.id, "user_password_changed", db)
    user.password_hash = hash_password(payload.new_password)
    user.must_change_password = False
    user.session_version += 1
    db.commit()
    session_expires_at = _set_cookie(response, user, "mfa_setup" if not user.mfa_enabled else "active")
    return {"user": _user_response(user), "mfa_setup_required": not user.mfa_enabled, "session_expires_at": session_expires_at}


@app.patch("/api/v1/auth/profile")
async def update_own_profile(
    payload: ProfileUpdatePayload,
    request: Request,
    db: Annotated[Session, Depends(get_access_db)],
) -> dict[str, object]:
    user, _ = _current_user(request, db, {"active"})
    if user.display_name != payload.display_name:
        principal = DemoPrincipal(
            user.id,
            user.username,
            user.display_name or user.name,
            "system_admin" if user.is_superuser else ("admin" if "admin" in user.modules else (user.modules[0] if user.modules else "")),
            user.modules,
            user.permissions,
            is_superuser=user.is_superuser,
        )
        await record_audit_event(principal, user.id, "user_display_name_changed", db)
        user.display_name = payload.display_name
        db.commit()
    return {"user": _user_response(user)}


@app.get("/api/v1/auth/mfa/setup")
def mfa_setup(
    request: Request,
    db: Annotated[Session, Depends(get_access_db)],
) -> dict[str, str]:
    user, _claims = _current_user(request, db, {"mfa_setup"})
    if user.mfa_enabled:
        raise HTTPException(status_code=409, detail="MFA já está configurado")
    if not user.mfa_secret_encrypted:
        user.mfa_secret_encrypted = encrypt_mfa_secret(new_totp_secret())
        db.commit()
    secret = _read_mfa_secret(user.mfa_secret_encrypted)
    emit_audit_event(
        _audit_principal(user),
        "management",
        "mfa_setup_secret_read",
        user.id,
        service="access",
    )
    return {"secret": secret, "otpauth_uri": totp_uri(secret, user.username)}


@app.post("/api/v1/auth/mfa/confirm")
def mfa_confirm(
    payload: TotpPayload,
    request: Request,
    response: Response,
    db: Annotated[Session, Depends(get_access_db)],
) -> dict[str, object]:
    user, _ = _current_user(request, db, {"mfa_setup"})
    if not user.mfa_secret_encrypted or not verify_totp(_read_mfa_secret(user.mfa_secret_encrypted), payload.code):
        user.failed_attempts += 1
        if user.failed_attempts >= 5:
            user.locked_until = datetime.now(UTC) + timedelta(minutes=LOCKOUT_MINUTES)
            user.failed_attempts = 0
            user.session_version += 1
        db.commit()
        raise HTTPException(status_code=401, detail="Código MFA inválido")
    user.mfa_enabled = True
    user.failed_attempts = 0
    user.locked_until = None
    user.session_version += 1
    db.commit()
    session_expires_at = _set_cookie(response, user, "active")
    return {"user": _user_response(user), "session_expires_at": session_expires_at}


@app.post("/api/v1/auth/refresh")
def refresh_session(
    request: Request,
    response: Response,
    db: Annotated[Session, Depends(get_access_db)],
) -> dict[str, object]:
    user, claims = _current_user(request, db)
    session_expires_at = _set_cookie(response, user, str(claims["stage"]))
    return {"user": _user_response(user), "session_expires_at": session_expires_at}


@app.post("/api/v1/auth/logout", status_code=204)
def logout(
    request: Request,
    response: Response,
    db: Annotated[Session, Depends(get_access_db)],
) -> Response:
    try:
        user, _ = _current_user(request, db)
        user.session_version += 1
        db.commit()
    except HTTPException:
        pass
    response.delete_cookie(SESSION_COOKIE, path="/", httponly=True, secure=os.getenv("SCPO_COOKIE_SECURE", "true").lower() == "true", samesite="strict")
    response.status_code = 204
    return response


@app.get("/api/v1/auth/session")
def current_session(
    request: Request,
    db: Annotated[Session, Depends(get_access_db)],
) -> dict[str, object]:
    user, claims = _current_user(request, db)
    if user.must_change_password or not user.mfa_enabled:
        raise HTTPException(status_code=403, detail="Conclua a configuração de segurança da conta")
    emit_audit_event(
        _audit_principal(user),
        "management",
        "authenticated_session_read",
        user.id,
        service="access",
    )
    return {"user": _user_response(user), "session_expires_at": claims["exp"]}


@app.post("/api/v1/auth/activity", status_code=204)
def record_user_activity(
    request: Request,
    db: Annotated[Session, Depends(get_access_db)],
) -> Response:
    user, _ = _current_user(request, db, {"active"})
    activity = db.get(SystemUserActivity, user.id)
    if activity is None:
        activity = SystemUserActivity(user_id=user.id, last_activity_at=datetime.now(UTC))
        db.add(activity)
    else:
        activity.last_activity_at = datetime.now(UTC)
    db.commit()
    return Response(status_code=204)


@app.get("/api/v1/app/module-settings")
def app_module_settings(
    request: Request,
    db: Annotated[Session, Depends(get_access_db)],
) -> dict[str, object]:
    _current_user(request, db)
    settings = _system_module_settings(db)
    return _module_settings_response(settings)


def _announcement_response(item: AppAnnouncement) -> dict[str, object]:
    return {
        "id": item.id,
        "title": item.title,
        "url": item.url,
        "summary": item.summary,
        "content": item.content,
        "kind": item.kind,
        "active": item.active,
        "published_at": item.published_at.isoformat(),
        "expires_at": item.expires_at.isoformat() if item.expires_at else None,
        "created_by_name": item.created_by_name,
    }


@app.get("/api/v1/app/announcements")
def list_app_announcements(
    request: Request,
    db: Annotated[Session, Depends(get_access_db)],
) -> dict[str, object]:
    _current_user(request, db)
    now = datetime.now(UTC)
    items = db.scalars(
        select(AppAnnouncement)
        .where(
            AppAnnouncement.active.is_(True),
            AppAnnouncement.published_at <= now,
            (AppAnnouncement.expires_at.is_(None)) | (AppAnnouncement.expires_at > now),
        )
        .order_by(AppAnnouncement.published_at.desc(), AppAnnouncement.created_at.desc())
        .limit(20)
    ).all()
    upcoming_start = db.scalar(
        select(func.min(AppAnnouncement.published_at)).where(
            AppAnnouncement.active.is_(True),
            AppAnnouncement.published_at > now,
            (AppAnnouncement.expires_at.is_(None))
            | (AppAnnouncement.expires_at > AppAnnouncement.published_at),
        )
    )
    upcoming_expiration = db.scalar(
        select(func.min(AppAnnouncement.expires_at)).where(
            AppAnnouncement.active.is_(True),
            AppAnnouncement.published_at <= now,
            AppAnnouncement.expires_at > now,
        )
    )
    boundaries = [
        value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
        for value in (upcoming_start, upcoming_expiration)
        if value is not None
    ]
    next_change = min(boundaries) if boundaries else None
    return {
        "announcements": [_announcement_response(item) for item in items],
        "next_change_at": next_change.isoformat() if next_change else None,
    }


@app.get("/api/v1/system-admin/announcements")
@app.get("/api/v1/admin/announcements")
def list_system_admin_announcements(
    request: Request,
    db: Annotated[Session, Depends(get_access_db)],
) -> dict[str, object]:
    _, principal = _require_account_admin(request, db)
    items = db.scalars(
        select(AppAnnouncement).order_by(AppAnnouncement.created_at.desc()).limit(100)
    ).all()
    emit_audit_event(principal, "management", "app_announcements_read", "all", service="access")
    return {"announcements": [_announcement_response(item) for item in items]}


@app.post("/api/v1/system-admin/announcements", status_code=201)
@app.post("/api/v1/admin/announcements", status_code=201)
def create_system_admin_announcement(
    payload: AppAnnouncementPayload,
    request: Request,
    db: Annotated[Session, Depends(get_access_db)],
) -> dict[str, object]:
    user, principal = _require_account_admin(request, db)
    now = datetime.now(UTC)
    published_at = payload.published_at or now
    if payload.expires_at is not None and payload.expires_at <= published_at:
        raise HTTPException(
            status_code=422,
            detail="O encerramento deve ser posterior ao início da exibição",
        )
    item = AppAnnouncement(
        id=str(uuid.uuid4()),
        title=payload.title.strip(),
        url=payload.url.strip() if payload.url else None,
        summary=payload.summary.strip() if payload.summary and payload.summary.strip() else None,
        content=payload.content.strip() if payload.content and payload.content.strip() else None,
        kind=payload.kind,
        active=payload.active,
        published_at=published_at,
        expires_at=payload.expires_at,
        created_by_id=user.id,
        created_by_name=principal.actor_name,
        created_at=now,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    emit_audit_event(principal, "management", "app_announcement_created", item.id, db=db, service="access")
    db.commit()
    return _announcement_response(item)


@app.patch("/api/v1/system-admin/announcements/{announcement_id}")
@app.patch("/api/v1/admin/announcements/{announcement_id}")
def update_system_admin_announcement(
    announcement_id: str,
    payload: AppAnnouncementPayload,
    request: Request,
    db: Annotated[Session, Depends(get_access_db)],
) -> dict[str, object]:
    _, principal = _require_account_admin(request, db)
    item = db.get(AppAnnouncement, announcement_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Informativo não encontrado")
    current_published_at = item.published_at
    if current_published_at.tzinfo is None:
        current_published_at = current_published_at.replace(tzinfo=UTC)
    published_at = payload.published_at or current_published_at
    if payload.expires_at is not None and payload.expires_at <= published_at:
        raise HTTPException(
            status_code=422,
            detail="O encerramento deve ser posterior ao início da exibição",
        )
    item.title = payload.title.strip()
    item.url = payload.url.strip() if payload.url else None
    item.summary = payload.summary.strip() if payload.summary and payload.summary.strip() else None
    item.content = payload.content.strip() if payload.content and payload.content.strip() else None
    item.kind = payload.kind
    item.published_at = published_at
    item.expires_at = payload.expires_at
    item.active = payload.active
    db.commit()
    db.refresh(item)
    emit_audit_event(principal, "management", "app_announcement_updated", item.id, db=db, service="access")
    db.commit()
    return _announcement_response(item)


@app.delete("/api/v1/system-admin/announcements/{announcement_id}", status_code=204)
@app.delete("/api/v1/admin/announcements/{announcement_id}", status_code=204)
def delete_system_admin_announcement(
    announcement_id: str,
    request: Request,
    db: Annotated[Session, Depends(get_access_db)],
) -> Response:
    _, principal = _require_account_admin(request, db)
    item = db.get(AppAnnouncement, announcement_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Informativo não encontrado")
    db.delete(item)
    emit_audit_event(principal, "management", "app_announcement_deleted", item.id, db=db, service="access")
    db.commit()
    return Response(status_code=204)


@app.post("/internal/v1/auth/introspect")
def introspect(
    payload: AuthEventPayload,
    db: Annotated[Session, Depends(get_access_db)],
    _: Annotated[None, Depends(require_service_token)],
) -> dict[str, object]:
    claims = read_session(payload.token)
    if not claims or claims.get("stage") != "active":
        raise HTTPException(status_code=401, detail="Sessão inválida")
    user = db.get(AppUser, str(claims["sub"]))
    locked_until = user.locked_until if user else None
    if locked_until and locked_until.tzinfo is None:
        locked_until = locked_until.replace(tzinfo=UTC)
    if user is None or not user.active or not user.mfa_enabled or user.must_change_password or claims.get("sv") != user.session_version or (locked_until and locked_until > datetime.now(UTC)):
        raise HTTPException(status_code=401, detail="Sessão revogada")
    settings = _system_module_settings(db)
    return {
        **_user_response(user),
        **_module_settings_response(settings),
    }


@app.get("/api/v1/system-admin/module-settings")
def system_admin_module_settings(
    request: Request,
    db: Annotated[Session, Depends(get_access_db)],
) -> dict[str, object]:
    _, principal = _require_system_admin(request, db)
    emit_audit_event(
        principal, "management", "system_module_settings_read", "all", service="access"
    )
    return _module_settings_response(
        _system_module_settings(db),
        include_audit_metadata=True,
    )


@app.get("/api/v1/system-admin/active-users")
def system_admin_active_users(
    request: Request,
    db: Annotated[Session, Depends(get_access_db)],
) -> dict[str, object]:
    _, principal = _require_system_admin(request, db)
    checked_at = datetime.now(UTC)
    cutoff = checked_at - timedelta(minutes=5)
    active_users = db.execute(
        select(AppUser, SystemUserActivity)
        .join(SystemUserActivity, SystemUserActivity.user_id == AppUser.id)
        .where(
            AppUser.active.is_(True),
            SystemUserActivity.last_activity_at >= cutoff,
        )
        .order_by(SystemUserActivity.last_activity_at.desc(), AppUser.name)
    ).all()
    emit_audit_event(
        principal,
        "management",
        "system_active_users_read",
        "active_users",
        service="access",
    )
    return {
        "window_minutes": 5,
        "checked_at": checked_at.isoformat(),
        "users": [
            {
                "user_id": user.id,
                "name": user.display_name or user.name,
                "role": _user_response(user)["role"],
                "last_activity_at": activity.last_activity_at.isoformat(),
            }
            for user, activity in active_users
        ],
    }


@app.patch("/api/v1/system-admin/module-settings")
def update_system_admin_module_settings(
    payload: SystemModuleSettingsPayload,
    request: Request,
    db: Annotated[Session, Depends(get_access_db)],
) -> dict[str, object]:
    _, principal = _require_system_admin(request, db)
    settings = _system_module_settings(db)
    module_enabled = {
        module: settings.module_enabled.get(module, True)
        for module in GLOBAL_MODULES
    }
    for module, enabled in payload.module_enabled.items():
        if module_enabled[module] == enabled:
            continue
        module_enabled[module] = enabled
        emit_audit_event(
            principal,
            "management",
            "system_module_enabled" if enabled else "system_module_disabled",
            module,
            db=db,
            service="access",
        )
    settings.module_enabled = module_enabled
    if payload.maintenance_mode is not None and payload.maintenance_mode != settings.maintenance_mode:
        settings.maintenance_mode = payload.maintenance_mode
        emit_audit_event(
            principal,
            "management",
            "system_maintenance_mode_enabled" if payload.maintenance_mode else "system_maintenance_mode_disabled",
            "all",
            db=db,
            service="access",
        )
    settings.updated_at = datetime.now(UTC)
    settings.updated_by_id = principal.user_id
    settings.updated_by_name = principal.actor_name[:120]
    db.commit()
    return _module_settings_response(settings, include_audit_metadata=True)


@app.get("/api/v1/access/users")
def list_users(
    request: Request,
    db: Annotated[Session, Depends(get_access_db)],
) -> dict[str, list[dict[str, object]]]:
    _, principal = _require_account_admin(request, db)
    emit_audit_event(
        principal, "management", "user_accounts_read", "all", service="access"
    )
    users = db.scalars(
        select(AppUser)
        .where(AppUser.is_superuser.is_(False))
        .order_by(AppUser.name)
    ).all()
    pending_ids = set(db.scalars(select(PhysicianProfileDeletionOutbox.user_id)).all())
    return {"users": [_user_response(user, user.id in pending_ids) for user in users]}


@app.get("/api/v1/system-admin/users")
def list_system_admin_users(
    request: Request,
    db: Annotated[Session, Depends(get_access_db)],
) -> dict[str, list[dict[str, object]]]:
    _, principal = _require_system_admin(request, db)
    emit_audit_event(
        principal, "management", "system_admin_user_accounts_read", "all", service="access"
    )
    users = db.scalars(
        select(AppUser).where(AppUser.is_superuser.is_(False)).order_by(AppUser.name)
    ).all()
    pending_ids = set(db.scalars(select(PhysicianProfileDeletionOutbox.user_id)).all())
    return {"users": [_user_response(user, user.id in pending_ids) for user in users]}


@app.post("/api/v1/system-admin/reset-credentials")
async def reset_all_user_credentials(
    payload: ResetAllCredentialsPayload,
    request: Request,
    response: Response,
    db: Annotated[Session, Depends(get_access_db)],
) -> dict[str, object]:
    actor, principal = _require_system_admin(request, db)
    if not verify_password(payload.current_password, actor.password_hash):
        raise HTTPException(status_code=401, detail="A senha do superusuário está incorreta")
    if payload.confirmation != "REDEFINIR CREDENCIAIS DE TODOS OS USUÁRIOS":
        raise HTTPException(status_code=422, detail="A confirmação digitada não corresponde ao texto solicitado")
    users = db.scalars(
        select(AppUser)
        .where(
            AppUser.is_superuser.is_(False),
            ~AppUser.id.in_(select(PhysicianProfileDeletionOutbox.user_id)),
        )
        .order_by(AppUser.username)
    ).all()
    await record_audit_event(principal, "non_superuser_accounts", "all_user_credentials_reset", db)
    reset_accounts = []
    for user in users:
        reset_accounts.append(
            {"username": user.username, "temporary_password": _reset_credentials(user)}
        )
    db.commit()
    response.headers["Cache-Control"] = "no-store"
    return {"accounts": reset_accounts}


@app.post("/api/v1/system-admin/users/{user_id}/reset-credentials")
async def reset_one_user_credentials(
    user_id: str,
    request: Request,
    response: Response,
    db: Annotated[Session, Depends(get_access_db)],
) -> dict[str, object]:
    _, principal = _require_system_admin(request, db)
    user = db.get(AppUser, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    _prevent_superuser_changes(user)
    _ensure_not_deletion_pending(db, user.id)
    await record_audit_event(principal, user.id, "user_credentials_reset", db)
    temporary_password = _reset_credentials(user)
    db.commit()
    response.headers["Cache-Control"] = "no-store"
    return {"user": _user_response(user), "initial_password": temporary_password}


@app.post("/api/v1/access/users/{user_id}/reset-password")
async def reset_user_password(
    user_id: str,
    request: Request,
    response: Response,
    db: Annotated[Session, Depends(get_access_db)],
) -> dict[str, object]:
    actor, principal = _require_account_admin(request, db)
    user = db.get(AppUser, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    _prevent_superuser_changes(user)
    _ensure_not_deletion_pending(db, user.id)
    if user.id == actor.id:
        raise HTTPException(status_code=409, detail="Use a troca de senha da própria conta")
    await record_audit_event(principal, user.id, "user_password_reset", db)
    temporary_password = _reset_password(user)
    db.commit()
    response.headers["Cache-Control"] = "no-store"
    return {"user": _user_response(user), "initial_password": temporary_password}


@app.post("/api/v1/access/users", status_code=201)
async def create_user(
    payload: UserCreatePayload,
    request: Request,
    response: Response,
    db: Annotated[Session, Depends(get_access_db)],
) -> dict[str, object]:
    actor, principal = _require_account_admin(request, db)
    can_grant_management = actor.is_superuser or (
        "admin" in actor.modules and "administrar" in actor.permissions.get("admin", [])
    )
    if not can_grant_management and "management" in payload.modules:
        raise HTTPException(status_code=403, detail="Somente a Administração do aplicativo pode conceder esse acesso amplo")
    username = payload.username.strip().lower()
    if db.scalar(select(AppUser.id).where(AppUser.username == username)):
        raise HTTPException(status_code=409, detail="Este usuário já existe")
    if username == SYSTEM_SUPERADMIN_USERNAME:
        raise HTTPException(status_code=409, detail="Este nome de usuário não está disponível")
    modules = (
        sorted(MODULES)
        if "management" in payload.modules
        else ["admin"]
        if "admin" in payload.modules
        else payload.modules
    )
    permissions = _validate_permissions(modules, payload.permissions)
    temporary_password = INITIAL_PASSWORD
    user = _new_user(username, payload.name, modules, permissions, temporary_password)
    await record_audit_event(principal, user.id, "user_created", db)
    db.add(user)
    db.commit()
    db.refresh(user)
    response.headers["Cache-Control"] = "no-store"
    return {**_user_response(user), "initial_password": temporary_password}


@app.patch("/api/v1/access/users/{user_id}")
async def update_user(
    user_id: str,
    payload: UserUpdatePayload,
    request: Request,
    db: Annotated[Session, Depends(get_access_db)],
) -> dict[str, object]:
    actor, principal = _require_account_admin(request, db)
    user = db.get(AppUser, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    _prevent_superuser_changes(user)
    _ensure_not_deletion_pending(db, user.id)
    changes = payload.model_dump(exclude_unset=True)
    if user.id == actor.id and changes.get("active") is False:
        raise HTTPException(status_code=409, detail="Não é possível desativar a própria conta")
    modules = changes.get("modules", user.modules)
    if len(set(modules)) != len(modules) or set(modules) - MODULES:
        raise HTTPException(status_code=422, detail="Módulo inválido ou repetido")
    can_grant_management = actor.is_superuser or (
        "admin" in actor.modules and "administrar" in actor.permissions.get("admin", [])
    )
    if not can_grant_management and (
        "management" in modules or "management" in user.modules
    ):
        raise HTTPException(status_code=403, detail="Somente a Administração do aplicativo pode alterar esse acesso amplo")
    if "management" in modules:
        modules = sorted(MODULES)
    elif "admin" in modules:
        modules = ["admin"]
    if "management" in user.modules and (changes.get("active") is False or "management" not in modules):
        other_masters = db.scalars(select(AppUser).where(AppUser.active.is_(True), AppUser.id != user.id)).all()
        if not any("management" in item.modules for item in other_masters):
            raise HTTPException(status_code=409, detail="Mantenha ao menos uma conta de Gestão Hospitalar ativa")
    submitted_permissions = changes.get("permissions")
    if submitted_permissions is None:
        defaults = _validate_permissions(modules, None)
        submitted_permissions = {
            module: user.permissions.get(module, defaults[module]) for module in modules
        }
    permissions = _validate_permissions(modules, submitted_permissions)
    await record_audit_event(principal, user.id, "user_access_changed", db)
    if "name" in changes:
        user.name = changes["name"]
    user.modules = modules
    user.permissions = permissions
    if "active" in changes:
        user.active = changes["active"]
    user.session_version += 1
    db.commit()
    return _user_response(user)


@app.delete("/api/v1/access/users/{user_id}")
async def delete_user(
    user_id: str,
    request: Request,
    response: Response,
    db: Annotated[Session, Depends(get_access_db)],
) -> dict[str, object]:
    actor, principal = _require_account_admin(request, db)
    user = db.get(AppUser, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    _prevent_superuser_changes(user)
    if db.get(PhysicianProfileDeletionOutbox, user.id) is not None:
        response.status_code = 202
        return {"message": "A exclusão do perfil médico está em andamento", "deletion_pending": True}
    if user.id == actor.id:
        raise HTTPException(status_code=409, detail="Não é possível excluir a própria conta")
    if "management" in user.modules:
        other_managers = db.scalars(
            select(AppUser).where(
                AppUser.active.is_(True),
                AppUser.id != user.id,
                AppUser.is_superuser.is_(False),
            )
        ).all()
        if not any("management" in candidate.modules for candidate in other_managers):
            raise HTTPException(status_code=409, detail="Mantenha ao menos uma conta de Gestão Hospitalar ativa")
    if "physician" in user.modules:
        now = datetime.now(UTC)
        db.add(
            PhysicianProfileDeletionOutbox(
                user_id=user.id,
                actor_id=actor.id,
                actor_name=principal.actor_name[:100],
                actor_role=principal.role[:40],
                requested_at=now,
                next_attempt_at=now,
            )
        )
        user.active = False
        user.session_version += 1
        emit_audit_event(
            principal, "management", "user_deletion_requested", user.id, db=db, service="access"
        )
        db.commit()
        response.status_code = 202
        return {"message": "A conta foi desativada; a remoção do perfil médico está em andamento", "deletion_pending": True}
    await record_audit_event(principal, user.id, "user_deleted", db)
    db.delete(user)
    db.commit()
    return {"message": "Conta excluída"}
