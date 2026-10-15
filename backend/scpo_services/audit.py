import hmac
import os
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import DateTime, Integer, String, select
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
ADMIN_ROLE = require_demo_role("management")


class AuditEventPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    actor_name: str = Field(min_length=1, max_length=100)
    actor_role: str = Field(min_length=1, max_length=40)
    action: str = Field(min_length=1, max_length=60)
    module: str = Field(min_length=1, max_length=40)
    target_id: str = Field(min_length=1, max_length=40)


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
    event = AuditEvent(**payload.model_dump(), happened_at=datetime.now(UTC))
    db.add(event)
    db.commit()
    db.refresh(event)
    return serialize_event(event)


@app.get("/api/v1/audit/events")
def list_events(
    _: Annotated[DemoPrincipal, Depends(ADMIN_ROLE)],
    db: Annotated[Session, Depends(get_audit_db)],
) -> dict[str, list[dict[str, object]]]:
    events = db.scalars(
        select(AuditEvent).order_by(AuditEvent.happened_at.desc()).limit(100)
    ).all()
    return {"events": [serialize_event(event) for event in events]}


def serialize_event(event: AuditEvent) -> dict[str, object]:
    return {
        "id": event.id,
        "actor_name": event.actor_name,
        "actor_role": event.actor_role,
        "action": event.action,
        "module": event.module,
        "target_id": event.target_id,
        "happened_at": event.happened_at.isoformat(),
    }
