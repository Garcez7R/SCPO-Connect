"""Authenticated staff work orders and the maintenance team's service queue."""

import uuid
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime, time, timedelta
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import DateTime, ForeignKey, Integer, String, case, select
from sqlalchemy.orm import Mapped, Session, mapped_column

from .common import Base, DemoPrincipal, authenticated_principal, database_session, get_engine, verify_database_migrated, verify_patient_reference, emit_audit_event


class WorkOrder(Base):
    __tablename__ = "work_orders"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str] = mapped_column(String(1500), nullable=False)
    service_type: Mapped[str] = mapped_column(String(80), nullable=False, default="Outro serviço")
    department: Mapped[str] = mapped_column(String(100), nullable=False)
    location: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    patient_reference: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    priority: Mapped[str] = mapped_column(String(12), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    requester_id: Mapped[str] = mapped_column(String(36), nullable=False)
    requester_name: Mapped[str] = mapped_column(String(120), nullable=False)
    updated_by: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class WorkOrderEvent(Base):
    __tablename__ = "work_order_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    order_id: Mapped[str] = mapped_column(ForeignKey("work_orders.id", ondelete="CASCADE"), nullable=False, index=True)
    actor_id: Mapped[str] = mapped_column(String(36), nullable=False)
    actor_name: Mapped[str] = mapped_column(String(120), nullable=False)
    action: Mapped[str] = mapped_column(String(24), nullable=False)
    old_status: Mapped[str | None] = mapped_column(String(16), nullable=True)
    new_status: Mapped[str] = mapped_column(String(16), nullable=False)
    note: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    happened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


def get_maintenance_db():
    yield from database_session("maintenance")


@asynccontextmanager
async def lifespan(_: FastAPI):
    verify_database_migrated("maintenance")
    yield


app = FastAPI(title="SCPO Connect · Ordens de Serviço", version="1.0.0", lifespan=lifespan)
AUTHENTICATED = Depends(authenticated_principal)


class WorkOrderCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=5, max_length=120)
    description: str = Field(min_length=5, max_length=1500)
    service_type: str = Field(default="Outro serviço", min_length=2, max_length=80)
    department: str = Field(min_length=2, max_length=100)
    location: str = Field(default="", max_length=120)
    patient_reference: str | None = Field(default=None, max_length=36)
    priority: Literal["normal", "high", "urgent"] = "normal"


class WorkOrderUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["open", "in_progress", "completed", "cancelled"]
    note: str = Field(default="", max_length=500)


def _require_maintenance(principal: DemoPrincipal, action: str) -> None:
    if "maintenance" not in principal.modules or action not in principal.permissions.get("maintenance", []):
        raise HTTPException(status_code=403, detail="A fila e a atualização de ordens são restritas à equipe de manutenção")


def _serialize_order(order: WorkOrder) -> dict[str, object]:
    return {
        "id": order.id,
        "title": order.title,
        "description": order.description,
        "service_type": order.service_type,
        "department": order.department,
        "location": order.location,
        "patient_reference": order.patient_reference,
        "priority": order.priority,
        "status": order.status,
        "requester_id": order.requester_id,
        "requester_name": order.requester_name,
        "updated_by": order.updated_by,
        "created_at": order.created_at.isoformat(),
        "updated_at": order.updated_at.isoformat(),
    }


@app.get("/health")
def health() -> dict[str, str]:
    return {"service": "maintenance", "status": "ok"}


@app.post("/api/v1/maintenance/orders", status_code=201)
def create_order(
    payload: WorkOrderCreate,
    principal: Annotated[DemoPrincipal, AUTHENTICATED],
    db: Annotated[Session, Depends(get_maintenance_db)],
) -> dict[str, object]:
    if payload.patient_reference:
        verify_patient_reference(payload.patient_reference)
    now = datetime.now(UTC)
    order = WorkOrder(
        id=str(uuid.uuid4()),
        **payload.model_dump(),
        status="open",
        requester_id=principal.user_id,
        requester_name=principal.actor_name,
        updated_by=principal.actor_name,
        created_at=now,
        updated_at=now,
    )
    db.add(order)
    db.flush()
    db.add(WorkOrderEvent(
        order_id=order.id,
        actor_id=principal.user_id,
        actor_name=principal.actor_name,
        action="opened",
        old_status=None,
        new_status="open",
        note="",
        happened_at=now,
    ))
    db.commit()
    db.refresh(order)
    emit_audit_event(principal, "maintenance", "work_order_created", order.patient_reference or order.id)
    return _serialize_order(order)


@app.get("/api/v1/maintenance/orders")
def list_my_orders(
    principal: Annotated[DemoPrincipal, AUTHENTICATED],
    db: Annotated[Session, Depends(get_maintenance_db)],
) -> dict[str, list[dict[str, object]]]:
    orders = db.scalars(
        select(WorkOrder)
        .where(WorkOrder.requester_id == principal.user_id)
        .order_by(WorkOrder.created_at.desc())
    ).all()
    emit_audit_event(principal, "maintenance", "work_orders_read", "own_orders")
    return {"orders": [_serialize_order(order) for order in orders]}


@app.get("/api/v1/maintenance/queue")
def maintenance_queue(
    principal: Annotated[DemoPrincipal, AUTHENTICATED],
    db: Annotated[Session, Depends(get_maintenance_db)],
    from_date: date | None = Query(default=None),
    to_date: date | None = Query(default=None),
    service_type: str | None = Query(default=None, max_length=80),
    department: str | None = Query(default=None, max_length=100),
    status: Literal["open", "in_progress", "completed", "cancelled"] | None = None,
    priority: Literal["normal", "high", "urgent"] | None = None,
    q: str | None = Query(default=None, max_length=120),
) -> dict[str, list[dict[str, object]]]:
    _require_maintenance(principal, "consultar")
    if from_date and to_date and from_date > to_date:
        raise HTTPException(status_code=422, detail="A data inicial deve ser anterior à data final")
    query = select(WorkOrder)
    if from_date:
        query = query.where(WorkOrder.created_at >= datetime.combine(from_date, time.min, tzinfo=UTC))
    if to_date:
        query = query.where(WorkOrder.created_at < datetime.combine(to_date + timedelta(days=1), time.min, tzinfo=UTC))
    if service_type:
        query = query.where(WorkOrder.service_type == service_type)
    if department:
        query = query.where(WorkOrder.department == department)
    if status:
        query = query.where(WorkOrder.status == status)
    if priority:
        query = query.where(WorkOrder.priority == priority)
    if q:
        term = f"%{q.strip()}%"
        query = query.where(WorkOrder.title.ilike(term) | WorkOrder.description.ilike(term) | WorkOrder.location.ilike(term) | WorkOrder.requester_name.ilike(term))
    priority_order = case((WorkOrder.priority == "urgent", 0), (WorkOrder.priority == "high", 1), else_=2)
    status_order = case((WorkOrder.status == "open", 0), (WorkOrder.status == "in_progress", 1), else_=2)
    orders = db.scalars(query.order_by(status_order, priority_order, WorkOrder.created_at.asc())).all()
    emit_audit_event(principal, "maintenance", "maintenance_queue_read", "work_order_queue")
    return {"orders": [_serialize_order(order) for order in orders]}


@app.get("/api/v1/maintenance/orders/{order_id}/events")
def list_order_events(
    order_id: str,
    principal: Annotated[DemoPrincipal, AUTHENTICATED],
    db: Annotated[Session, Depends(get_maintenance_db)],
) -> dict[str, list[dict[str, object]]]:
    order = db.get(WorkOrder, order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="Ordem de serviço não encontrada")
    if order.requester_id != principal.user_id:
        _require_maintenance(principal, "consultar")
    events = db.scalars(select(WorkOrderEvent).where(WorkOrderEvent.order_id == order_id).order_by(WorkOrderEvent.happened_at.asc())).all()
    emit_audit_event(principal, "maintenance", "work_order_events_read", order_id)
    return {"events": [{
        "id": event.id,
        "actor_name": event.actor_name,
        "action": event.action,
        "old_status": event.old_status,
        "new_status": event.new_status,
        "note": event.note,
        "happened_at": event.happened_at.isoformat(),
    } for event in events]}


@app.patch("/api/v1/maintenance/orders/{order_id}")
def update_order(
    order_id: str,
    payload: WorkOrderUpdate,
    principal: Annotated[DemoPrincipal, AUTHENTICATED],
    db: Annotated[Session, Depends(get_maintenance_db)],
) -> dict[str, object]:
    _require_maintenance(principal, "alterar")
    order = db.get(WorkOrder, order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="Ordem de serviço não encontrada")
    if order.status in {"completed", "cancelled"} and payload.status != order.status:
        raise HTTPException(status_code=409, detail="Reabra a ordem em uma nova solicitação")
    now = datetime.now(UTC)
    db.add(WorkOrderEvent(
        order_id=order.id,
        actor_id=principal.user_id,
        actor_name=principal.actor_name,
        action="status_changed",
        old_status=order.status,
        new_status=payload.status,
        note=payload.note.strip(),
        happened_at=now,
    ))
    order.status = payload.status
    order.updated_by = principal.actor_name
    order.updated_at = now
    db.commit()
    db.refresh(order)
    emit_audit_event(principal, "maintenance", "work_order_status_changed", order.patient_reference or order.id)
    return _serialize_order(order)
