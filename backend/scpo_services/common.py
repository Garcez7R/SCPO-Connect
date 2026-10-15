import os
import logging
from collections.abc import Generator
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated

import httpx
from fastapi import Header, HTTPException, Request
from sqlalchemy import Engine, create_engine, event, inspect
from sqlalchemy.orm import DeclarativeBase, Session

from .security import SESSION_COOKIE


class Base(DeclarativeBase):
    pass


@dataclass(frozen=True)
class DemoPrincipal:
    """Authenticated app user; name and permissions are resolved server-side."""

    user_id: str
    username: str
    actor_name: str
    role: str
    modules: list[str]
    permissions: dict[str, list[str]]


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
    expected_revision = "0014_pharmacy_inventory_details"
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
            role=str(data["role"]),
            modules=list(data["modules"]),
            permissions={str(k): list(v) for k, v in data["permissions"].items()},
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


def emit_audit_event(principal: DemoPrincipal, module: str, action: str, target_id: str) -> None:
    """Send a minimum-necessary access event; never include clinical payloads."""
    audit_url = os.getenv("SCPO_AUDIT_API_URL")
    service_token = os.getenv("SCPO_SERVICE_TOKEN")
    if not audit_url or not service_token:
        _logger.error("Clinical audit unavailable: service not configured (%s/%s)", module, action)
        return
    try:
        response = httpx.post(
            f"{audit_url.rstrip('/')}/internal/v1/events",
            headers={"X-Service-Token": service_token},
            json={"actor_name": principal.actor_name, "actor_role": principal.role,
                  "action": action, "module": module, "target_id": target_id[:40]},
            timeout=2.0,
        )
        response.raise_for_status()
    except httpx.HTTPError:
        _logger.exception("Clinical audit delivery failed (%s/%s)", module, action)
