"""Authenticated staff work orders and the maintenance team's service queue."""

import uuid
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime, time, timedelta
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, case, select
from sqlalchemy.orm import Mapped, Session, mapped_column, relationship

from .common import (
    Base,
    DemoPrincipal,
    audit_outbox_lifespan,
    authenticated_principal,
    database_session,
    emit_audit_event,
    require_demo_role,
    verify_database_migrated,
    verify_patient_reference,
)


class WorkOrder(Base):
    __tablename__ = "work_orders"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str] = mapped_column(String(1500), nullable=False)
    service_type: Mapped[str] = mapped_column(String(80), nullable=False, default="Outro serviço")
    department: Mapped[str] = mapped_column(String(100), nullable=False)
    location: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    patient_reference: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    asset_id: Mapped[str | None] = mapped_column(ForeignKey("equipment_assets.id", ondelete="SET NULL"), nullable=True)
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


class HygieneRequest(Base):
    __tablename__ = "hygiene_requests"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    request_type: Mapped[str] = mapped_column(String(32), nullable=False)
    custom_type: Mapped[str | None] = mapped_column(String(80), nullable=True)
    unit: Mapped[str] = mapped_column(String(80), nullable=False)
    area: Mapped[str] = mapped_column(String(32), nullable=False)
    location: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str] = mapped_column(String(1000), nullable=False, default="")
    priority: Mapped[str] = mapped_column(String(12), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    assignee: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    requester_id: Mapped[str] = mapped_column(String(36), nullable=False)
    requester_name: Mapped[str] = mapped_column(String(120), nullable=False)
    updated_by: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class EquipmentAsset(Base):
    __tablename__ = "equipment_assets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    asset_tag: Mapped[str] = mapped_column(String(40), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    category: Mapped[str] = mapped_column(String(60), nullable=False)
    unit: Mapped[str] = mapped_column(String(100), nullable=False)
    location: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    manufacturer: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    model: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    serial_number: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    created_by: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class PreventiveMaintenancePlan(Base):
    __tablename__ = "preventive_maintenance_plans"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    asset_id: Mapped[str] = mapped_column(ForeignKey("equipment_assets.id", ondelete="CASCADE"), nullable=False)
    procedure: Mapped[str] = mapped_column(String(300), nullable=False)
    interval_days: Mapped[int] = mapped_column(Integer, nullable=False)
    due_date: Mapped[date] = mapped_column(Date, nullable=False)
    responsible: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="scheduled")
    last_completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    asset: Mapped[EquipmentAsset] = relationship()


def get_maintenance_db():
    yield from database_session("maintenance")


@asynccontextmanager
async def lifespan(_: FastAPI):
    verify_database_migrated("maintenance")
    async with audit_outbox_lifespan("maintenance"):
        yield


app = FastAPI(title="SCPO Connect · Ordens de Serviço", version="1.0.0", lifespan=lifespan)
AUTHENTICATED = Depends(authenticated_principal)
HYGIENE_ROLE = require_demo_role("hygiene")


class HygieneRequestCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_type: Literal["routine", "spot", "after_procedure", "restock", "other"]
    custom_type: str | None = Field(default=None, min_length=3, max_length=80)
    unit: str = Field(min_length=2, max_length=80)
    area: Literal["room", "bathroom", "shared", "clinical", "circulation", "other"]
    location: str = Field(min_length=2, max_length=120)
    description: str = Field(default="", max_length=1000)
    priority: Literal["normal", "high", "urgent"] = "normal"

    @field_validator("unit", "location", "description", "custom_type", mode="before")
    @classmethod
    def trim_hygiene_text(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @model_validator(mode="after")
    def validate_custom_type(self) -> "HygieneRequestCreate":
        if self.request_type == "other" and not self.custom_type:
            raise ValueError("Informe o tipo da solicitação")
        if self.request_type != "other" and self.custom_type:
            raise ValueError("Tipo personalizado só pode ser informado para outra solicitação")
        return self


class HygieneRequestUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["open", "in_progress", "completed", "cancelled"] | None = None
    assignee: str | None = Field(default=None, max_length=120)

    @field_validator("assignee", mode="before")
    @classmethod
    def trim_assignee(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


def _serialize_hygiene_request(request: HygieneRequest) -> dict[str, object]:
    return {
        "id": request.id,
        "request_type": request.request_type,
        "custom_type": request.custom_type,
        "unit": request.unit,
        "area": request.area,
        "location": request.location,
        "description": request.description,
        "priority": request.priority,
        "status": request.status,
        "assignee": request.assignee,
        "requester_id": request.requester_id,
        "requester_name": request.requester_name,
        "updated_by": request.updated_by,
        "created_at": request.created_at.isoformat(),
        "updated_at": request.updated_at.isoformat(),
    }


@app.get("/api/v1/hygiene/requests")
def list_hygiene_requests(
    principal: Annotated[DemoPrincipal, Depends(HYGIENE_ROLE)],
    db: Annotated[Session, Depends(get_maintenance_db)],
) -> dict[str, list[dict[str, object]]]:
    priority_order = case(
        (HygieneRequest.priority == "urgent", 0),
        (HygieneRequest.priority == "high", 1),
        else_=2,
    )
    status_order = case(
        (HygieneRequest.status == "open", 0),
        (HygieneRequest.status == "in_progress", 1),
        else_=2,
    )
    requests = db.scalars(
        select(HygieneRequest).order_by(
            status_order, priority_order, HygieneRequest.created_at.asc()
        ).limit(500)
    ).all()
    emit_audit_event(principal, "hygiene", "hygiene_requests_read", "hygiene_queue")
    return {"requests": [_serialize_hygiene_request(item) for item in requests]}


@app.post("/api/v1/hygiene/requests", status_code=201)
def create_hygiene_request(
    payload: HygieneRequestCreate,
    principal: Annotated[DemoPrincipal, AUTHENTICATED],
    db: Annotated[Session, Depends(get_maintenance_db)],
) -> dict[str, object]:
    now = datetime.now(UTC)
    request = HygieneRequest(
        id=str(uuid.uuid4()),
        **payload.model_dump(),
        status="open",
        assignee="",
        requester_id=principal.user_id,
        requester_name=principal.actor_name,
        updated_by=principal.actor_name,
        created_at=now,
        updated_at=now,
    )
    db.add(request)
    emit_audit_event(principal, "hygiene", "hygiene_request_created", request.id, db=db)
    db.commit()
    db.refresh(request)
    return _serialize_hygiene_request(request)


@app.patch("/api/v1/hygiene/requests/{request_id}")
def update_hygiene_request(
    request_id: str,
    payload: HygieneRequestUpdate,
    principal: Annotated[DemoPrincipal, Depends(HYGIENE_ROLE)],
    db: Annotated[Session, Depends(get_maintenance_db)],
) -> dict[str, object]:
    changes = payload.model_dump(exclude_unset=True, exclude_none=True)
    if not changes:
        raise HTTPException(status_code=422, detail="Informe uma alteração para a solicitação")
    request = db.get(HygieneRequest, request_id)
    if request is None:
        raise HTTPException(status_code=404, detail="Solicitação de higienização não encontrada")
    if request.status in {"completed", "cancelled"} and changes.get("status", request.status) != request.status:
        raise HTTPException(status_code=409, detail="Solicitação encerrada; abra uma nova solicitação para novo atendimento")
    for field, value in changes.items():
        setattr(request, field, value)
    request.updated_by = principal.actor_name
    request.updated_at = datetime.now(UTC)
    emit_audit_event(principal, "hygiene", "hygiene_request_updated", request.id, db=db)
    db.commit()
    db.refresh(request)
    return _serialize_hygiene_request(request)


class WorkOrderCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=5, max_length=120)
    description: str = Field(min_length=5, max_length=1500)
    service_type: str = Field(default="Outro serviço", min_length=2, max_length=80)
    department: str = Field(min_length=2, max_length=100)
    location: str = Field(default="", max_length=120)
    patient_reference: str | None = Field(default=None, max_length=36)
    asset_id: str | None = Field(default=None, max_length=36)
    asset_tag: str | None = Field(default=None, max_length=40)
    priority: Literal["normal", "high", "urgent"] = "normal"

    @field_validator("service_type")
    @classmethod
    def route_hygiene_to_dedicated_queue(cls, value: str) -> str:
        if value.strip().casefold() in {"higienização", "higienizacao"}:
            raise ValueError("Solicitações de higienização devem usar a fila própria")
        return value

    @field_validator("asset_tag")
    @classmethod
    def normalize_asset_tag(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip().upper() or None


class WorkOrderUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["open", "in_progress", "completed", "cancelled"]
    note: str = Field(default="", max_length=500)


class EquipmentAssetPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    asset_tag: str = Field(min_length=2, max_length=40)
    name: str = Field(min_length=2, max_length=120)
    category: str = Field(min_length=2, max_length=60)
    unit: str = Field(min_length=2, max_length=100)
    location: str = Field(default="", max_length=120)
    manufacturer: str = Field(default="", max_length=100)
    model: str = Field(default="", max_length=100)
    serial_number: str = Field(default="", max_length=100)

    @field_validator("asset_tag")
    @classmethod
    def normalize_asset_tag(cls, value: str) -> str:
        return value.strip().upper()

    @field_validator("name", "category", "unit", "location", "manufacturer", "model", "serial_number")
    @classmethod
    def trim_asset_text(cls, value: str) -> str:
        return value.strip()


class PreventiveMaintenancePlanPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    asset_id: str = Field(min_length=1, max_length=36)
    procedure: str = Field(min_length=3, max_length=300)
    interval_days: int = Field(gt=0, le=3650)
    due_date: date
    responsible: str = Field(default="", max_length=120)

    @field_validator("procedure", "responsible")
    @classmethod
    def trim_plan_text(cls, value: str) -> str:
        return value.strip()


class PreventiveMaintenanceCompletionPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["completed"]


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
        "asset_id": order.asset_id,
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
    asset_id = payload.asset_id
    if payload.asset_tag:
        asset = db.scalar(
            select(EquipmentAsset).where(
                EquipmentAsset.asset_tag == payload.asset_tag.strip().upper()
            )
        )
        if asset is None or asset.status != "active":
            raise HTTPException(status_code=404, detail="Ativo patrimonial não encontrado ou inativo")
        if asset_id and asset_id != asset.id:
            raise HTTPException(status_code=422, detail="O patrimônio informado não corresponde ao ativo")
        asset_id = asset.id
    if asset_id:
        asset = db.get(EquipmentAsset, asset_id)
        if asset is None or asset.status != "active":
            raise HTTPException(status_code=404, detail="Ativo patrimonial não encontrado ou inativo")
    now = datetime.now(UTC)
    order = WorkOrder(
        id=str(uuid.uuid4()),
        **payload.model_dump(exclude={"asset_tag", "asset_id"}),
        asset_id=asset_id,
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
    emit_audit_event(
        principal, "maintenance", "work_order_created",
        order.patient_reference or order.id, db=db,
    )
    db.commit()
    db.refresh(order)
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
    from_date: Annotated[date | None, Query()] = None,
    to_date: Annotated[date | None, Query()] = None,
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
    emit_audit_event(
        principal, "maintenance", "work_order_status_changed",
        order.patient_reference or order.id, db=db,
    )
    db.commit()
    db.refresh(order)
    return _serialize_order(order)


@app.get("/api/v1/maintenance/assets")
def list_assets(
    principal: Annotated[DemoPrincipal, Depends(require_demo_role("maintenance", "management"))],
    db: Annotated[Session, Depends(get_maintenance_db)],
) -> dict[str, list[dict[str, object]]]:
    assets = db.scalars(
        select(EquipmentAsset).order_by(EquipmentAsset.unit, EquipmentAsset.asset_tag)
    ).all()
    emit_audit_event(principal, "maintenance", "equipment_assets_read", "all")
    return {"assets": [_serialize_asset(asset) for asset in assets]}


@app.post("/api/v1/maintenance/assets", status_code=201)
def create_asset(
    payload: EquipmentAssetPayload,
    principal: Annotated[DemoPrincipal, Depends(require_demo_role("maintenance", "management"))],
    db: Annotated[Session, Depends(get_maintenance_db)],
) -> dict[str, object]:
    duplicate = db.scalar(
        select(EquipmentAsset.id).where(EquipmentAsset.asset_tag == payload.asset_tag)
    )
    if duplicate:
        raise HTTPException(status_code=409, detail="Já existe um ativo com este patrimônio")
    now = datetime.now(UTC)
    asset = EquipmentAsset(
        id=str(uuid.uuid4()),
        **payload.model_dump(),
        status="active",
        created_by=principal.actor_name,
        created_at=now,
    )
    db.add(asset)
    emit_audit_event(principal, "maintenance", "equipment_asset_created", asset.id, db=db)
    db.commit()
    db.refresh(asset)
    return _serialize_asset(asset)


@app.get("/api/v1/maintenance/preventive-plans")
def list_preventive_plans(
    principal: Annotated[DemoPrincipal, Depends(require_demo_role("maintenance", "management"))],
    db: Annotated[Session, Depends(get_maintenance_db)],
) -> dict[str, list[dict[str, object]]]:
    plans = db.scalars(
        select(PreventiveMaintenancePlan)
        .join(EquipmentAsset)
        .order_by(PreventiveMaintenancePlan.due_date, EquipmentAsset.asset_tag)
    ).all()
    emit_audit_event(principal, "maintenance", "preventive_plans_read", "all")
    return {"plans": [_serialize_preventive_plan(plan) for plan in plans]}


@app.post("/api/v1/maintenance/preventive-plans", status_code=201)
def create_preventive_plan(
    payload: PreventiveMaintenancePlanPayload,
    principal: Annotated[DemoPrincipal, Depends(require_demo_role("maintenance", "management"))],
    db: Annotated[Session, Depends(get_maintenance_db)],
) -> dict[str, object]:
    asset = db.get(EquipmentAsset, payload.asset_id)
    if asset is None or asset.status != "active":
        raise HTTPException(status_code=404, detail="Ativo não encontrado ou inativo")
    plan = PreventiveMaintenancePlan(
        id=str(uuid.uuid4()),
        **payload.model_dump(),
        status="scheduled",
        last_completed_at=None,
        created_by=principal.actor_name,
        created_at=datetime.now(UTC),
    )
    db.add(plan)
    emit_audit_event(principal, "maintenance", "preventive_plan_created", plan.id, db=db)
    db.commit()
    db.refresh(plan)
    return _serialize_preventive_plan(plan)


@app.patch("/api/v1/maintenance/preventive-plans/{plan_id}")
def complete_preventive_plan(
    plan_id: str,
    payload: PreventiveMaintenanceCompletionPayload,
    principal: Annotated[DemoPrincipal, Depends(require_demo_role("maintenance", "management"))],
    db: Annotated[Session, Depends(get_maintenance_db)],
) -> dict[str, object]:
    plan = db.get(PreventiveMaintenancePlan, plan_id)
    if plan is None:
        raise HTTPException(status_code=404, detail="Plano preventivo não encontrado")
    now = datetime.now(UTC)
    plan.last_completed_at = now
    plan.due_date = now.date() + timedelta(days=plan.interval_days)
    plan.status = "scheduled"
    emit_audit_event(principal, "maintenance", "preventive_plan_completed", plan.id, db=db)
    db.commit()
    db.refresh(plan)
    return _serialize_preventive_plan(plan)


def _serialize_asset(asset: EquipmentAsset) -> dict[str, object]:
    return {
        "id": asset.id,
        "asset_tag": asset.asset_tag,
        "name": asset.name,
        "category": asset.category,
        "unit": asset.unit,
        "location": asset.location,
        "manufacturer": asset.manufacturer,
        "model": asset.model,
        "serial_number": asset.serial_number,
        "status": asset.status,
        "created_by": asset.created_by,
        "created_at": asset.created_at.isoformat(),
    }


def _serialize_preventive_plan(plan: PreventiveMaintenancePlan) -> dict[str, object]:
    return {
        "id": plan.id,
        "asset_id": plan.asset_id,
        "asset_tag": plan.asset.asset_tag if plan.asset else "",
        "asset_name": plan.asset.name if plan.asset else "",
        "procedure": plan.procedure,
        "interval_days": plan.interval_days,
        "due_date": plan.due_date.isoformat(),
        "responsible": plan.responsible,
        "status": plan.status,
        "last_completed_at": plan.last_completed_at.isoformat() if plan.last_completed_at else None,
    }
