import asyncio
import hashlib
import hmac
import json
import logging
import os
import uuid
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime, time, timedelta
from typing import Annotated

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import Boolean, DateTime, Integer, String, delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Mapped, Session, mapped_column

from .common import (
    Base,
    DemoPrincipal,
    database_session,
    get_engine,
    require_demo_role,
    verify_database_migrated,
)

GENESIS_HASH = "0" * 64
RETENTION_DAYS = 365
OUTBOX_SERVICES = ("access", "nursing", "pharmacy", "social", "xray", "maintenance")
logger = logging.getLogger("scpo.audit.retention")


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    actor_name: Mapped[str] = mapped_column(String(100), nullable=False)
    actor_role: Mapped[str] = mapped_column(String(40), nullable=False)
    action: Mapped[str] = mapped_column(String(60), nullable=False)
    module: Mapped[str] = mapped_column(String(40), nullable=False)
    target_id: Mapped[str] = mapped_column(String(40), nullable=False)
    happened_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    source_event_id: Mapped[str] = mapped_column(String(36), nullable=False, unique=True)
    previous_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    event_hash: Mapped[str] = mapped_column(String(64), nullable=False)


class AuditChainHead(Base):
    __tablename__ = "audit_chain_heads"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    last_hash: Mapped[str] = mapped_column(String(64), nullable=False)


class AuditChainCheckpoint(Base):
    __tablename__ = "audit_chain_checkpoints"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    last_pruned_event_id: Mapped[int] = mapped_column(Integer, nullable=False)
    last_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    pruned_through: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    pruning: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


def get_audit_db():
    yield from database_session("audit")


@asynccontextmanager
async def lifespan(_: FastAPI):
    verify_database_migrated("audit")
    task = asyncio.create_task(_run_retention_worker())
    try:
        yield
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


app = FastAPI(
    title="SCPO Connect · Serviço de Auditoria",
    version="1.0.0",
    description="Registra eventos administrativos mínimos, sem conteúdo clínico.",
    lifespan=lifespan,
)
ADMIN_ROLE = require_demo_role("management", "admin", "oversight")


class AuditEventPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_event_id: str = Field(min_length=1, max_length=36)
    actor_name: str = Field(min_length=1, max_length=100)
    actor_role: str = Field(min_length=1, max_length=40)
    action: str = Field(min_length=1, max_length=60)
    module: str = Field(min_length=1, max_length=40)
    target_id: str = Field(min_length=1, max_length=40)
    happened_at: datetime | None = None


@app.get("/health")
def health() -> dict[str, str]:
    return {"service": "audit", "status": "ok"}


@app.post("/internal/v1/events", status_code=201)
def create_event(
    payload: AuditEventPayload,
    db: Annotated[Session, Depends(get_audit_db)],
    x_service_token: Annotated[str | None, Header(alias="X-Service-Token")] = None,
) -> dict[str, object]:
    expected = os.getenv("SCPO_SERVICE_TOKEN")
    if (
        not expected
        or not x_service_token
        or not hmac.compare_digest(expected, x_service_token)
    ):
        raise HTTPException(status_code=403, detail="Serviço não autorizado")
    chain_head = db.scalar(
        select(AuditChainHead).where(AuditChainHead.id == 1).with_for_update()
    )
    if chain_head is None:
        raise HTTPException(status_code=503, detail="Cadeia de auditoria não inicializada")
    existing = db.scalar(
        select(AuditEvent).where(AuditEvent.source_event_id == payload.source_event_id)
    )
    if existing:
        return serialize_event(existing)
    happened_at = _canonical_datetime(payload.happened_at or datetime.now(UTC))
    previous_hash = chain_head.last_hash
    event_hash = calculate_event_hash(
        payload.source_event_id,
        payload.actor_name,
        payload.actor_role,
        payload.action,
        payload.module,
        payload.target_id,
        happened_at,
        previous_hash,
    )
    event = AuditEvent(
        source_event_id=payload.source_event_id,
        actor_name=payload.actor_name,
        actor_role=payload.actor_role,
        action=payload.action,
        module=payload.module,
        target_id=payload.target_id,
        happened_at=happened_at,
        previous_hash=previous_hash,
        event_hash=event_hash,
    )
    chain_head.last_hash = event_hash
    db.add(event)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        existing = db.scalar(
            select(AuditEvent).where(AuditEvent.source_event_id == payload.source_event_id)
        )
        if existing:
            return serialize_event(existing)
        raise HTTPException(status_code=503, detail="Não foi possível registrar evento na cadeia de auditoria") from exc
    db.refresh(event)
    return serialize_event(event)


@app.get("/api/v1/audit/events")
def list_events(
    principal: Annotated[DemoPrincipal, Depends(ADMIN_ROLE)],
    db: Annotated[Session, Depends(get_audit_db)],
    from_date: date | None = None,
    to_date: date | None = None,
    module: Annotated[str | None, Query(max_length=40)] = None,
    search: Annotated[str | None, Query(max_length=120)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> dict[str, object]:
    if from_date and to_date and from_date > to_date:
        raise HTTPException(status_code=422, detail="A data inicial deve ser anterior ou igual à data final")

    _record_audit_read(principal, db, "audit_events_read", "audit_events")
    statement = select(AuditEvent)
    if not principal.is_superuser:
        statement = statement.where(AuditEvent.actor_role != "system_admin")
    if from_date:
        statement = statement.where(
            AuditEvent.happened_at >= datetime.combine(from_date, time.min, tzinfo=UTC)
        )
    if to_date:
        statement = statement.where(
            AuditEvent.happened_at <= datetime.combine(to_date, time.max, tzinfo=UTC)
        )
    if module:
        statement = statement.where(AuditEvent.module == module)
    if normalized_search := (search or "").strip():
        pattern = f"%{normalized_search}%"
        statement = statement.where(
            or_(
                AuditEvent.actor_name.ilike(pattern),
                AuditEvent.action.ilike(pattern),
                AuditEvent.module.ilike(pattern),
                AuditEvent.target_id.ilike(pattern),
            )
        )
    total = db.scalar(select(func.count()).select_from(statement.subquery())) or 0
    events = db.scalars(
        statement.order_by(AuditEvent.id.desc()).limit(limit).offset(offset)
    ).all()
    return {
        "events": [serialize_event(event) for event in events],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@app.get("/api/v1/audit/integrity")
def verify_audit_integrity(
    principal: Annotated[DemoPrincipal, Depends(ADMIN_ROLE)],
    db: Annotated[Session, Depends(get_audit_db)],
) -> dict[str, object]:
    _record_audit_read(principal, db, "audit_integrity_read", "audit_chain")
    return verify_chain(db)


@app.get("/api/v1/audit/outbox-status")
async def get_audit_outbox_status(
    principal: Annotated[DemoPrincipal, Depends(ADMIN_ROLE)],
    db: Annotated[Session, Depends(get_audit_db)],
) -> dict[str, object]:
    _record_audit_read(principal, db, "audit_outbox_status_read", "audit_outboxes")
    service_token = os.getenv("SCPO_SERVICE_TOKEN", "")
    services: list[dict[str, object]] = []

    async def fetch_status(client: httpx.AsyncClient, service: str) -> dict[str, object]:
        service_url = os.getenv(f"SCPO_{service.upper()}_API_URL", "").rstrip("/")
        if not service_url or not service_token:
            return {
                "service": service,
                "status": "unavailable",
                "error": "Serviço não configurado",
            }
        try:
            response = await client.get(
                f"{service_url}/internal/v1/audit/outbox-status",
                headers={"X-Service-Token": service_token},
            )
            response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, dict):
                raise TypeError("Resposta de status inválida")
            return {"service": service, "status": "ok", **payload}
        except (httpx.HTTPError, TypeError, ValueError) as exc:
            logger.error("Could not read audit outbox status for %s: %s", service, exc)
            return {
                "service": service,
                "status": "unavailable",
                "error": "Não foi possível consultar a fila",
            }

    async with httpx.AsyncClient(timeout=3.0) as client:
        services = list(
            await asyncio.gather(
                *(fetch_status(client, service) for service in OUTBOX_SERVICES)
            )
        )
    now = datetime.now(UTC)
    attention_required = False
    for service_status in services:
        if service_status.get("status") != "ok":
            attention_required = True
            continue
        oldest = service_status.get("oldest_pending_at")
        try:
            oldest_at = datetime.fromisoformat(str(oldest)) if oldest else None
        except ValueError:
            oldest_at = None
            service_status["status"] = "unavailable"
            service_status["error"] = "Data de pendência inválida"
            attention_required = True
        if oldest_at and oldest_at.tzinfo is None:
            oldest_at = oldest_at.replace(tzinfo=UTC)
        age_seconds = (now - oldest_at).total_seconds() if oldest_at else 0
        service_status["oldest_pending_minutes"] = max(0, int(age_seconds // 60))
        if (
            int(service_status.get("failed_count", 0)) > 0
            or age_seconds >= 5 * 60
        ):
            attention_required = True
    return {
        "attention_required": attention_required,
        "threshold_minutes": 5,
        "services": services,
        "checked_at": now.isoformat(),
    }


def _record_audit_read(
    principal: DemoPrincipal,
    db: Session,
    action: str,
    target_id: str,
) -> None:
    token = os.getenv("SCPO_SERVICE_TOKEN", "")
    payload = AuditEventPayload(
        source_event_id=str(uuid.uuid4()),
        actor_name=principal.actor_name,
        actor_role=principal.role,
        action=action,
        module="oversight",
        target_id=target_id,
        happened_at=datetime.now(UTC),
    )
    create_event(payload, db, token)


def verify_chain(db: Session) -> dict[str, object]:
    checkpoint = db.get(AuditChainCheckpoint, 1)
    previous_hash = checkpoint.last_hash if checkpoint else GENESIS_HASH
    after_id = checkpoint.last_pruned_event_id if checkpoint else 0
    events_checked = 0
    invalid_event_id: int | None = None
    events = db.scalars(
        select(AuditEvent)
        .where(AuditEvent.id > after_id)
        .order_by(AuditEvent.id)
        .execution_options(yield_per=1000)
    )
    for event in events:
        events_checked += 1
        expected_hash = calculate_event_hash(
            event.source_event_id,
            event.actor_name,
            event.actor_role,
            event.action,
            event.module,
            event.target_id,
            event.happened_at,
            previous_hash,
        )
        if event.previous_hash != previous_hash or event.event_hash != expected_hash:
            invalid_event_id = event.id
            break
        previous_hash = event.event_hash
    chain_head = db.get(AuditChainHead, 1)
    head_matches = chain_head is not None and chain_head.last_hash == previous_hash
    return {
        "valid": invalid_event_id is None and head_matches and checkpoint is not None,
        "events_checked": events_checked,
        "invalid_event_id": invalid_event_id,
        "chain_head_matches": head_matches,
        "last_hash": previous_hash,
        "checkpoint_event_id": after_id,
        "pruned_through": (
            checkpoint.pruned_through.isoformat()
            if checkpoint and checkpoint.pruned_through
            else None
        ),
        "verified_at": datetime.now(UTC).isoformat(),
    }


def prune_expired_events(
    now: datetime | None = None,
    retention_days: int = RETENTION_DAYS,
) -> int:
    if retention_days < 1:
        raise ValueError("A retenção deve ser de pelo menos um dia")
    cutoff = _canonical_datetime(now or datetime.now(UTC)) - timedelta(days=retention_days)
    with Session(get_engine("audit")) as db:
        checkpoint = db.scalar(
            select(AuditChainCheckpoint)
            .where(AuditChainCheckpoint.id == 1)
            .with_for_update()
        )
        if checkpoint is None:
            raise RuntimeError("Checkpoint da cadeia de auditoria não inicializado")
        integrity = verify_chain(db)
        if not integrity["valid"]:
            raise RuntimeError("Cadeia de auditoria inválida; retenção cancelada")
        last_pruned: AuditEvent | None = None
        for event in db.scalars(
            select(AuditEvent)
            .where(AuditEvent.id > checkpoint.last_pruned_event_id)
            .order_by(AuditEvent.id)
        ):
            happened_at = _canonical_datetime(event.happened_at)
            if happened_at >= cutoff:
                break
            last_pruned = event
        if last_pruned is None:
            return 0
        checkpoint.last_pruned_event_id = last_pruned.id
        checkpoint.last_hash = last_pruned.event_hash
        checkpoint.pruned_through = last_pruned.happened_at
        checkpoint.pruning = True
        db.flush()
        result = db.execute(
            delete(AuditEvent).where(AuditEvent.id <= last_pruned.id)
        )
        checkpoint.pruning = False
        db.commit()
        return result.rowcount or 0


async def _run_retention_worker() -> None:
    while True:
        try:
            deleted = await asyncio.to_thread(prune_expired_events)
            if deleted:
                logger.info("Pruned %s expired audit events", deleted)
        except Exception:
            logger.exception("Audit retention job failed")
        await asyncio.sleep(3600)


def calculate_event_hash(
    source_event_id: str,
    actor_name: str,
    actor_role: str,
    action: str,
    module: str,
    target_id: str,
    happened_at: datetime,
    previous_hash: str,
) -> str:
    happened_at = _canonical_datetime(happened_at)
    payload = {
        "source_event_id": source_event_id,
        "actor_name": actor_name,
        "actor_role": actor_role,
        "action": action,
        "module": module,
        "target_id": target_id,
        "happened_at": happened_at.isoformat(),
        "previous_hash": previous_hash,
    }
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _canonical_datetime(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def serialize_event(event: AuditEvent) -> dict[str, object]:
    return {
        "id": event.id,
        "actor_name": event.actor_name,
        "actor_role": event.actor_role,
        "action": event.action,
        "module": event.module,
        "target_id": event.target_id,
        "happened_at": event.happened_at.isoformat(),
        "source_event_id": event.source_event_id,
        "previous_hash": event.previous_hash,
        "event_hash": event.event_hash,
    }
