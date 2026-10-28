import asyncio
import logging
import os
import uuid
from collections.abc import Generator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Annotated, Literal
from urllib.parse import quote

import httpx
from fastapi import Header, HTTPException, Request
from sqlalchemy import (
    DateTime,
    Engine,
    Index,
    Integer,
    String,
    create_engine,
    event,
    inspect,
    select,
)
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column

from .security import SESSION_COOKIE


class Base(DeclarativeBase):
    pass


class AuditOutbox(Base):
    __tablename__ = "audit_outbox"
    __table_args__ = (Index("ix_audit_outbox_pending", "delivered_at", "next_attempt_at"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    actor_name: Mapped[str] = mapped_column(String(100), nullable=False)
    actor_role: Mapped[str] = mapped_column(String(40), nullable=False)
    action: Mapped[str] = mapped_column(String(60), nullable=False)
    module: Mapped[str] = mapped_column(String(40), nullable=False)
    target_id: Mapped[str] = mapped_column(String(40), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_error: Mapped[str] = mapped_column(String(500), nullable=False, default="")


@dataclass(frozen=True)
class DemoPrincipal:
    """Authenticated app user; name and permissions are resolved server-side."""

    user_id: str
    username: str
    actor_name: str
    role: str
    modules: list[str]
    permissions: dict[str, list[str]]
    is_superuser: bool = False


_engines: dict[str, Engine] = {}
_logger = logging.getLogger("scpo.audit")
_repo_root = Path(__file__).resolve().parents[2]


def get_engine(service: str) -> Engine:
    variable = f"SCPO_{service.upper()}_DATABASE_URL"
    url = os.getenv(variable)
    if not url:
        data_dir = _repo_root / "data"
        data_dir.mkdir(parents=True, exist_ok=True)
        url = f"sqlite:///{data_dir / f'{service}.sqlite3'}"

    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+psycopg://", 1)

    engine = _engines.get(url)
    if engine is None:
        options = {"pool_pre_ping": True}
        if url.startswith("sqlite:"):
            options["connect_args"] = {"check_same_thread": False}
        engine = create_engine(url, **options)
        if url.startswith("sqlite:"):
            @event.listens_for(engine, "connect")
            def _enable_sqlite_foreign_keys(dbapi_connection, _connection_record):
                cursor = dbapi_connection.cursor()
                cursor.execute("PRAGMA foreign_keys=ON")
                cursor.close()
        _engines[url] = engine
    return engine


def verify_database_migrated(service: str) -> None:
    engine = get_engine(service)
    if not inspect(engine).has_table("alembic_version"):
        raise RuntimeError(
            f"Banco de {service} sem migrações. Execute 'SCPO_SERVICE={service} alembic upgrade head'."
        )
    with engine.connect() as connection:
        revision = connection.exec_driver_sql(
            "SELECT version_num FROM alembic_version"
        ).scalar_one_or_none()
    expected_revision = "0052_nursing_offline_actions"
    if revision != expected_revision:
        raise RuntimeError(
            f"Banco de {service} desatualizado ({revision}). Execute 'SCPO_SERVICE={service} alembic upgrade head'."
        )


def database_session(service: str) -> Generator[Session, None, None]:
    with Session(get_engine(service)) as session:
        yield session


def clear_engine_cache() -> None:
    for engine in _engines.values():
        engine.dispose()
    _engines.clear()


def _outbox_database_service(service: str | None = None) -> str | None:
    current = service or os.getenv("SCPO_SERVICE")
    if current == "therapy":
        return "nursing"
    if current in {"access", "nursing", "pharmacy", "social", "xray", "maintenance"}:
        return current
    module_services = {
        "patients": "nursing",
        "nursing": "nursing",
        "physician": "nursing",
        "reception": "nursing",
        "nutrition": "nursing",
        "therapy": "nursing",
        "management": "nursing",
        "admin": "access",
        "pharmacy": "pharmacy",
        "social": "social",
        "psychology": "social",
        "xray": "xray",
        "maintenance": "maintenance",
        "hygiene": "maintenance",
    }
    return module_services.get(current or "")


def enqueue_audit_event(
    db: Session,
    principal: DemoPrincipal,
    module: str,
    action: str,
    target_id: str,
) -> AuditOutbox:
    now = datetime.now(UTC)
    record = AuditOutbox(
        id=str(uuid.uuid4()),
        actor_name=principal.actor_name[:100],
        actor_role=principal.role[:40],
        action=action[:60],
        module=module[:40],
        target_id=target_id[:40],
        created_at=now,
        next_attempt_at=now,
    )
    db.add(record)
    return record


def dispatch_pending_audit_events(service: str, limit: int = 25) -> int:
    if service == "audit":
        return 0
    audit_url = os.getenv("SCPO_AUDIT_API_URL")
    service_token = os.getenv("SCPO_SERVICE_TOKEN")
    now = datetime.now(UTC)
    delivered = 0
    with Session(get_engine(service)) as db:
        pending = db.scalars(
            select(AuditOutbox)
            .where(
                AuditOutbox.delivered_at.is_(None),
                AuditOutbox.next_attempt_at <= now,
            )
            .order_by(AuditOutbox.created_at)
            .limit(limit)
        ).all()
        for record in pending:
            try:
                if not audit_url or not service_token:
                    raise RuntimeError("Serviço de auditoria não configurado")
                response = httpx.post(
                    f"{audit_url.rstrip('/')}/internal/v1/events",
                    headers={"X-Service-Token": service_token},
                    json={
                        "source_event_id": record.id,
                        "actor_name": record.actor_name,
                        "actor_role": record.actor_role,
                        "action": record.action,
                        "module": record.module,
                        "target_id": record.target_id,
                        "happened_at": record.created_at.isoformat(),
                    },
                    timeout=2.0,
                )
                response.raise_for_status()
                record.delivered_at = datetime.now(UTC)
                record.last_error = ""
                delivered += 1
            except (httpx.HTTPError, RuntimeError) as exc:
                record.attempts += 1
                delay = min(3600, 2 ** min(record.attempts, 11))
                record.next_attempt_at = datetime.now(UTC) + timedelta(seconds=delay)
                record.last_error = str(exc)[:500]
                _logger.error(
                    "Audit outbox delivery deferred (%s/%s, attempt %s): %s",
                    record.module,
                    record.action,
                    record.attempts,
                    exc,
                )
        db.commit()
    return delivered


async def _run_audit_outbox_dispatcher(service: str) -> None:
    while True:
        try:
            await asyncio.to_thread(dispatch_pending_audit_events, service)
        except SQLAlchemyError:
            _logger.exception("Audit outbox dispatcher database error (%s)", service)
        await asyncio.sleep(5)


@asynccontextmanager
async def audit_outbox_lifespan(service: str):
    task = asyncio.create_task(_run_audit_outbox_dispatcher(service))
    try:
        yield
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


def _action_for_method(method: str) -> str:
    return {"GET": "consultar", "HEAD": "consultar", "POST": "criar", "PUT": "alterar", "PATCH": "alterar", "DELETE": "excluir"}.get(method.upper(), "consultar")


async def authenticated_principal(request: Request) -> DemoPrincipal:
    """Resolve any active app session without requiring a particular module."""
    token = request.cookies.get(SESSION_COOKIE)
    service_token = os.getenv("SCPO_SERVICE_TOKEN")
    access_url = os.getenv("SCPO_ACCESS_API_URL")
    if not token or not service_token or not access_url:
        raise HTTPException(status_code=401, detail="Sessão autenticada necessária")
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            response = await client.post(
                f"{access_url.rstrip('/')}/internal/v1/auth/introspect",
                headers={"X-Service-Token": service_token},
                json={"token": token},
            )
        if response.status_code != 200:
            raise HTTPException(status_code=401, detail="Sessão inválida ou expirada")
        data = response.json()
        return DemoPrincipal(
            user_id=str(data["id"]),
            username=str(data["username"]),
            actor_name=str(data["name"]),
            role="system_admin" if data.get("is_superuser") else str(data["role"]),
            modules=list(data["modules"]),
            permissions={str(k): list(v) for k, v in data["permissions"].items()},
            is_superuser=bool(data.get("is_superuser", False)),
        )
    except HTTPException:
        raise
    except (httpx.HTTPError, KeyError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=503, detail="Autenticação indisponível") from exc


def require_demo_role(*allowed_modules: str):
    """Compatibility name; authorization now uses server-issued local sessions."""

    async def authorize(request: Request) -> DemoPrincipal:
        principal = await authenticated_principal(request)

        action = _action_for_method(request.method)
        for module in allowed_modules:
            if module in principal.modules and action in principal.permissions.get(module, []):
                return principal
        raise HTTPException(status_code=403, detail="Acesso não autorizado para este módulo ou ação")

    return authorize


def require_demo_role_or_superuser(*allowed_modules: str):
    async def authorize(request: Request) -> DemoPrincipal:
        principal = await authenticated_principal(request)
        if principal.is_superuser:
            return principal

        action = _action_for_method(request.method)
        for module in allowed_modules:
            if module not in principal.modules:
                continue
            permissions = principal.permissions.get(module, [])
            if action in permissions or (
                module == "admin" and "administrar" in permissions
            ):
                return principal
        raise HTTPException(status_code=403, detail="Acesso não autorizado para este módulo ou ação")

    return authorize


def require_service_token(
    x_service_token: Annotated[str | None, Header(alias="X-Service-Token")] = None,
) -> None:
    import hmac

    expected = os.getenv("SCPO_SERVICE_TOKEN", "")
    if not expected or not x_service_token or not hmac.compare_digest(expected, x_service_token):
        raise HTTPException(status_code=403, detail="Serviço não autorizado")


def verify_patient_reference(reference: str) -> dict[str, str]:
    """Resolve a shared patient identifier against the nursing registry."""
    nursing_url = os.getenv("SCPO_NURSING_API_URL", "http://nursing:8000").rstrip("/")
    service_token = os.getenv("SCPO_SERVICE_TOKEN", "")
    if not service_token:
        raise HTTPException(status_code=503, detail="Validação do cadastro indisponível")
    try:
        response = httpx.post(
            f"{nursing_url}/internal/v1/patients/resolve",
            headers={"X-Service-Token": service_token},
            json={"reference": reference},
            timeout=3.0,
        )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=503, detail="Cadastro de pacientes indisponível") from exc
    if response.status_code == 404:
        raise HTTPException(status_code=404, detail="Paciente não encontrado ou inativo")
    if response.status_code != 200:
        raise HTTPException(status_code=503, detail="Não foi possível validar o paciente")
    try:
        data = response.json()
        return {"reference": str(data["reference"]), "name": str(data["name"]), "room": str(data["room"]), "bed": str(data["bed"])}
    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(status_code=503, detail="Resposta inválida do cadastro de pacientes") from exc


def update_hospital_bed_cleaning_state(
    bed_id: str,
    request_id: str,
    action: Literal["start", "release", "rollback"],
    actor_id: str,
    actor_name: str,
) -> dict[str, str]:
    nursing_url = os.getenv("SCPO_NURSING_API_URL", "http://nursing:8000").rstrip("/")
    service_token = os.getenv("SCPO_SERVICE_TOKEN", "")
    if not service_token:
        raise HTTPException(status_code=503, detail="Integração com os leitos indisponível")
    try:
        response = httpx.post(
            f"{nursing_url}/internal/v1/hospital-beds/{quote(bed_id, safe='')}/cleaning",
            headers={"X-Service-Token": service_token},
            json={
                "action": action,
                "request_id": request_id,
                "actor_id": actor_id,
                "actor_name": actor_name,
            },
            timeout=3.0,
        )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=503, detail="Serviço de Enfermagem indisponível") from exc
    if response.status_code == 404:
        raise HTTPException(status_code=404, detail="Leito não encontrado ou inativo")
    if response.status_code == 409:
        raise HTTPException(
            status_code=409,
            detail="O leito mudou de situação ou está ocupado; verifique a Gestão Hospitalar",
        )
    if response.status_code != 200:
        raise HTTPException(status_code=503, detail="Não foi possível atualizar a situação do leito")
    try:
        data = response.json()
        bed_status = str(data["status"])
        expected_status = "cleaning" if action == "start" else "available"
        if str(data["id"]) != bed_id or bed_status != expected_status:
            raise ValueError("Estado do leito não corresponde à operação")
        return {"id": bed_id, "status": bed_status}
    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(status_code=503, detail="Resposta inválida do serviço de Enfermagem") from exc


def resolve_medication_dispensation(dispensation_id: str) -> dict[str, str]:
    pharmacy_url = os.getenv("SCPO_PHARMACY_API_URL", "http://pharmacy:8000").rstrip("/")
    service_token = os.getenv("SCPO_SERVICE_TOKEN", "")
    if not service_token:
        raise HTTPException(status_code=503, detail="Validação da dispensação indisponível")
    try:
        response = httpx.post(
            f"{pharmacy_url}/internal/v1/pharmacy/dispensations/resolve",
            headers={"X-Service-Token": service_token},
            json={"id": dispensation_id},
            timeout=3.0,
        )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=503, detail="Serviço de Farmácia indisponível") from exc
    if response.status_code == 404:
        raise HTTPException(status_code=404, detail="Dispensação não encontrada ou indisponível")
    if response.status_code != 200:
        raise HTTPException(status_code=503, detail="Não foi possível validar a dispensação")
    try:
        data = response.json()
        return {
            "id": str(data["id"]),
            "patient_reference": str(data["patient_reference"]),
            "medication_name": str(data["medication_name"]),
            "quantity": str(data["quantity"]),
            "unit": str(data["unit"]),
        }
    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(status_code=503, detail="Resposta inválida da Farmácia") from exc


def emit_audit_event(
    principal: DemoPrincipal,
    module: str,
    action: str,
    target_id: str,
    *,
    db: Session | None = None,
    service: str | None = None,
) -> None:
    """Persist a minimum-necessary event locally; delivery is retried asynchronously."""
    database_service = _outbox_database_service(service or os.getenv("SCPO_SERVICE") or module)
    if database_service is None:
        raise RuntimeError(f"Audit outbox service is unknown for {module}/{action}")
    if db is not None:
        enqueue_audit_event(db, principal, module, action, target_id)
        return
    with Session(get_engine(database_service)) as outbox_db:
        enqueue_audit_event(outbox_db, principal, module, action, target_id)
        outbox_db.commit()
