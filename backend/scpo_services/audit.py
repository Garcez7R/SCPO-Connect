import hashlib
import hmac
import json
import os
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import DateTime, Integer, String, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Mapped, Session, mapped_column

from .common import (
    Base,
    DemoPrincipal,
    database_session,
    require_demo_role,
    verify_database_migrated,
)


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


def get_audit_db():
    yield from database_session("audit")


@asynccontextmanager
async def lifespan(_: FastAPI):
    verify_database_migrated("audit")
    yield


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
    _: Annotated[DemoPrincipal, Depends(ADMIN_ROLE)],
    db: Annotated[Session, Depends(get_audit_db)],
) -> dict[str, list[dict[str, object]]]:
    events = db.scalars(
        select(AuditEvent).order_by(AuditEvent.id.desc()).limit(100)
    ).all()
    return {"events": [serialize_event(event) for event in events]}


@app.get("/api/v1/audit/integrity")
def verify_audit_integrity(
    _: Annotated[DemoPrincipal, Depends(ADMIN_ROLE)],
    db: Annotated[Session, Depends(get_audit_db)],
) -> dict[str, object]:
    events = db.scalars(select(AuditEvent).order_by(AuditEvent.id)).all()
    previous_hash = "0" * 64
    invalid_event_id: int | None = None
    for event in events:
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
    valid = invalid_event_id is None and head_matches
    return {
        "valid": valid,
        "events_checked": len(events),
        "invalid_event_id": invalid_event_id,
        "chain_head_matches": head_matches,
        "last_hash": previous_hash,
        "verified_at": datetime.now(UTC).isoformat(),
    }


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
