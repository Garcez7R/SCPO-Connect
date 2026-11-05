"""Authenticated staff work orders and the maintenance team's service queue."""

import uuid
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import (
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
    case,
    func,
    select,
)
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Mapped, Session, mapped_column, relationship

from .common import (
    Base,
    DemoPrincipal,
    audit_outbox_lifespan,
    authenticated_principal,
    database_session,
    emit_audit_event,
    register_audit_outbox_status_route,
    require_demo_role,
    require_demo_role_or_superuser,
    update_hospital_bed_cleaning_state,
    verify_database_migrated,
    verify_patient_reference,
)


class ServiceRequestNumber(Base):
    __tablename__ = "service_request_numbers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class WorkOrder(Base):
    __tablename__ = "work_orders"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    service_number_id: Mapped[int | None] = mapped_column(
        ForeignKey("service_request_numbers.id"), nullable=True, unique=True
    )
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
    __table_args__ = (Index("ix_hygiene_requests_bed_id", "bed_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    service_number_id: Mapped[int | None] = mapped_column(
        ForeignKey("service_request_numbers.id"), nullable=True, unique=True
    )
    request_type: Mapped[str] = mapped_column(String(32), nullable=False)
    custom_type: Mapped[str | None] = mapped_column(String(80), nullable=True)
    unit: Mapped[str] = mapped_column(String(80), nullable=False)
    area: Mapped[str] = mapped_column(String(32), nullable=False)
    bed_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    bed_status: Mapped[str] = mapped_column(String(16), nullable=False, default="none")
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


class WarehouseItem(Base):
    __tablename__ = "warehouse_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    category: Mapped[str] = mapped_column(String(80), nullable=False)
    unit: Mapped[str] = mapped_column(String(24), nullable=False, default="unidade")
    location: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    barcode: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    lot: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    expiry_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    serial_number: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    balance: Mapped[str] = mapped_column(Numeric(12, 3), nullable=False, default="0")
    minimum_balance: Mapped[str] = mapped_column(Numeric(12, 3), nullable=False, default="0")
    active: Mapped[bool] = mapped_column(nullable=False, default=True)
    created_by: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class WarehouseMovement(Base):
    __tablename__ = "warehouse_movements"
    __table_args__ = (Index("ix_warehouse_movements_item_created", "item_id", "created_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    item_id: Mapped[str] = mapped_column(ForeignKey("warehouse_items.id", ondelete="CASCADE"), nullable=False, index=True)
    movement_type: Mapped[str] = mapped_column(String(16), nullable=False)
    quantity: Mapped[str] = mapped_column(Numeric(12, 3), nullable=False)
    balance_after: Mapped[str] = mapped_column(Numeric(12, 3), nullable=False)
    reason: Mapped[str] = mapped_column(String(500), nullable=False)
    destination: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    work_order_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    actor_id: Mapped[str] = mapped_column(String(36), nullable=False)
    actor_name: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class WarehouseRequest(Base):
    __tablename__ = "warehouse_requests"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    item_id: Mapped[str] = mapped_column(ForeignKey("warehouse_items.id", ondelete="CASCADE"), nullable=False, index=True)
    quantity: Mapped[str] = mapped_column(Numeric(12, 3), nullable=False)
    department: Mapped[str] = mapped_column(String(120), nullable=False)
    destination: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    justification: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    work_order_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    requester_id: Mapped[str] = mapped_column(String(36), nullable=False)
    requester_name: Mapped[str] = mapped_column(String(120), nullable=False)
    updated_by: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


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


class LaundryCatalogItem(Base):
    __tablename__ = "laundry_catalog_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    category: Mapped[str] = mapped_column(String(80), nullable=False)
    unit: Mapped[str] = mapped_column(String(20), nullable=False)
    created_by: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class LaundryRequest(Base):
    __tablename__ = "laundry_requests"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    request_number: Mapped[int] = mapped_column(
        ForeignKey("service_request_numbers.id"), nullable=False, unique=True
    )
    unit: Mapped[str] = mapped_column(String(80), nullable=False)
    area: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    priority: Mapped[str] = mapped_column(String(12), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    assignee: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    requester_id: Mapped[str] = mapped_column(String(36), nullable=False)
    requester_name: Mapped[str] = mapped_column(String(120), nullable=False)
    updated_by: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class LaundryRequestItem(Base):
    __tablename__ = "laundry_request_items"
    __table_args__ = (
        UniqueConstraint("request_id", "item_id", name="uq_laundry_request_item"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    request_id: Mapped[str] = mapped_column(
        ForeignKey("laundry_requests.id", ondelete="CASCADE"), nullable=False, index=True
    )
    item_id: Mapped[str] = mapped_column(
        ForeignKey("laundry_catalog_items.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    item: Mapped[LaundryCatalogItem] = relationship()


class LaundryInventoryMovement(Base):
    __tablename__ = "laundry_inventory_movements"
    __table_args__ = (Index("ix_laundry_inventory_item_created", "item_id", "created_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    item_id: Mapped[str] = mapped_column(
        ForeignKey("laundry_catalog_items.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    request_id: Mapped[str] = mapped_column(
        ForeignKey("laundry_requests.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    unit: Mapped[str] = mapped_column(String(80), nullable=False)
    movement_type: Mapped[str] = mapped_column(String(24), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    actor_id: Mapped[str] = mapped_column(String(36), nullable=False)
    actor_name: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    item: Mapped[LaundryCatalogItem] = relationship()


def get_maintenance_db():
    yield from database_session("maintenance")


@asynccontextmanager
async def lifespan(_: FastAPI):
    verify_database_migrated("maintenance")
    async with audit_outbox_lifespan("maintenance"):
        yield


app = FastAPI(title="SCPO Connect · Ordens de Serviço", version="1.0.0", lifespan=lifespan)
register_audit_outbox_status_route(app, "maintenance")
AUTHENTICATED = Depends(authenticated_principal)
HYGIENE_ROLE = require_demo_role("hygiene")
HYGIENE_REPORT_ACCESS = require_demo_role("hygiene", "management", "admin", "oversight")


class HygieneRequestCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_type: Literal["routine", "spot", "after_procedure", "restock", "other"]
    custom_type: str | None = Field(default=None, min_length=3, max_length=80)
    unit: str = Field(min_length=2, max_length=80)
    area: Literal["room", "bathroom", "shared", "clinical", "circulation", "other"]
    bed_id: str | None = Field(default=None, max_length=36)
    location: str = Field(min_length=2, max_length=120)
    description: str = Field(default="", max_length=1000)
    priority: Literal["normal", "high", "urgent"] = "normal"

    @field_validator("unit", "location", "description", "custom_type", mode="before")
    @classmethod
    def trim_hygiene_text(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @field_validator("bed_id")
    @classmethod
    def trim_bed_id(cls, value: str | None) -> str | None:
        if not value:
            return None
        try:
            return str(uuid.UUID(value.strip()))
        except ValueError as exc:
            raise ValueError("Identificador do leito inválido") from exc

    @model_validator(mode="after")
    def validate_custom_type(self) -> "HygieneRequestCreate":
        if self.request_type == "other" and not self.custom_type:
            raise ValueError("Informe o tipo da solicitação")
        if self.request_type != "other" and self.custom_type:
            raise ValueError("Tipo personalizado só pode ser informado para outra solicitação")
        if self.bed_id and self.area != "room":
            raise ValueError("Vincule um leito somente a uma solicitação de quarto/leito")
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
        "request_number": (
            f"{request.service_number_id:07d}" if request.service_number_id else ""
        ),
        "request_type": request.request_type,
        "custom_type": request.custom_type,
        "unit": request.unit,
        "area": request.area,
        "bed_id": request.bed_id,
        "bed_status": request.bed_status,
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
    principal: Annotated[DemoPrincipal, Depends(HYGIENE_REPORT_ACCESS)],
    db: Annotated[Session, Depends(get_maintenance_db)],
    limit: Annotated[int, Query(ge=1, le=500)] = 500,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> dict[str, object]:
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
    query = select(HygieneRequest)
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    requests = db.scalars(
        query.order_by(
            status_order, priority_order, HygieneRequest.created_at.asc()
        ).offset(offset).limit(limit)
    ).all()
    emit_audit_event(principal, "hygiene", "hygiene_requests_read", "hygiene_queue")
    return {"requests": [_serialize_hygiene_request(item) for item in requests], "total": total, "limit": limit, "offset": offset}


@app.post("/api/v1/hygiene/requests", status_code=201)
def create_hygiene_request(
    payload: HygieneRequestCreate,
    principal: Annotated[DemoPrincipal, AUTHENTICATED],
    db: Annotated[Session, Depends(get_maintenance_db)],
) -> dict[str, object]:
    now = datetime.now(UTC)
    request_id = str(uuid.uuid4())
    bed_status = "none"
    if payload.bed_id:
        if not (principal.is_superuser or {"hygiene", "management"} & set(principal.modules)):
            raise HTTPException(status_code=403, detail="Somente Higienização ou Gestão pode vincular um leito")
        update_hospital_bed_cleaning_state(
            payload.bed_id,
            request_id,
            "start",
            principal.user_id,
            principal.actor_name,
        )
        bed_status = "cleaning"
    request = HygieneRequest(
        id=request_id,
        service_number_id=_new_service_request_number(db, now),
        **payload.model_dump(),
        bed_status=bed_status,
        status="open",
        assignee="",
        requester_id=principal.user_id,
        requester_name=principal.actor_name,
        updated_by=principal.actor_name,
        created_at=now,
        updated_at=now,
    )
    try:
        db.add(request)
        emit_audit_event(principal, "hygiene", "hygiene_request_created", request.id, db=db)
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        if payload.bed_id:
            try:
                update_hospital_bed_cleaning_state(
                    payload.bed_id,
                    request_id,
                    "rollback",
                    principal.user_id,
                    principal.actor_name,
                )
            except HTTPException as rollback_error:
                raise HTTPException(
                    status_code=503,
                    detail="A solicitação não foi salva e o leito permanece bloqueado para higienização; acione a Gestão Hospitalar",
                ) from rollback_error
        raise
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
    if request.bed_id and changes.get("status") == "cancelled":
        raise HTTPException(
            status_code=409,
            detail="Conclua a higienização vinculada antes de encerrar a solicitação",
        )
    for field, value in changes.items():
        setattr(request, field, value)
    request.updated_by = principal.actor_name
    request.updated_at = datetime.now(UTC)
    emit_audit_event(principal, "hygiene", "hygiene_request_updated", request.id, db=db)
    db.commit()
    db.refresh(request)
    release_error = _release_completed_hygiene_bed(request, principal, db)
    response = _serialize_hygiene_request(request)
    if release_error:
        response["bed_release_error"] = release_error
    return response


def _release_completed_hygiene_bed(
    request: HygieneRequest,
    principal: DemoPrincipal,
    db: Session,
) -> str | None:
    if (
        request.status != "completed"
        or not request.bed_id
        or request.bed_status == "available"
    ):
        return None
    try:
        update_hospital_bed_cleaning_state(
            request.bed_id,
            request.id,
            "release",
            principal.user_id,
            principal.actor_name,
        )
    except HTTPException as exc:
        request.bed_status = "release_pending"
        request.updated_at = datetime.now(UTC)
        emit_audit_event(
            principal, "hygiene", "hygiene_bed_release_pending", request.id, db=db
        )
        db.commit()
        return str(exc.detail)
    request.bed_status = "available"
    request.updated_at = datetime.now(UTC)
    emit_audit_event(principal, "hygiene", "hygiene_bed_released", request.id, db=db)
    db.commit()
    db.refresh(request)
    return None


@app.post("/api/v1/hygiene/requests/{request_id}/bed-release")
def retry_hygiene_bed_release(
    request_id: str,
    principal: Annotated[DemoPrincipal, Depends(HYGIENE_ROLE)],
    db: Annotated[Session, Depends(get_maintenance_db)],
) -> dict[str, object]:
    request = db.get(HygieneRequest, request_id)
    if request is None:
        raise HTTPException(status_code=404, detail="Solicitação de higienização não encontrada")
    if request.status != "completed" or not request.bed_id:
        raise HTTPException(
            status_code=409,
            detail="Somente uma solicitação concluída e vinculada a leito pode liberar o leito",
        )
    release_error = _release_completed_hygiene_bed(request, principal, db)
    if release_error:
        raise HTTPException(
            status_code=503,
            detail=f"Higienização concluída; o leito continua bloqueado. Tente novamente após verificar o serviço de Enfermagem. {release_error}",
        )
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


class WarehouseItemPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=2, max_length=120)
    category: str = Field(min_length=2, max_length=80)
    unit: str = Field(min_length=1, max_length=24)
    location: str = Field(default="", max_length=120)
    barcode: str = Field(default="", max_length=80)
    lot: str = Field(default="", max_length=80)
    expiry_date: date | None = None
    serial_number: str = Field(default="", max_length=100)
    balance: Decimal = Field(default=Decimal("0"), ge=0, le=999_999_999, max_digits=12, decimal_places=3)
    minimum_balance: Decimal = Field(default=Decimal("0"), ge=0, le=999_999_999, max_digits=12, decimal_places=3)
    active: bool = True

    @field_validator("name", "category", "unit", "location", "barcode", "lot", "serial_number")
    @classmethod
    def trim_warehouse_text(cls, value: str) -> str:
        return value.strip()


class WarehouseMovementPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    movement_type: Literal["entry", "issue", "adjustment", "return", "loss"]
    quantity: Decimal = Field(gt=0, le=999_999_999, max_digits=12, decimal_places=3)
    reason: str = Field(min_length=2, max_length=500)
    destination: str = Field(default="", max_length=120)
    work_order_id: str | None = Field(default=None, max_length=36)

    @field_validator("reason", "destination")
    @classmethod
    def trim_movement_text(cls, value: str) -> str:
        return value.strip()


class WarehouseRequestPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    item_id: str = Field(min_length=36, max_length=36)
    quantity: Decimal = Field(gt=0, le=999_999_999, max_digits=12, decimal_places=3)
    department: str = Field(min_length=2, max_length=120)
    destination: str = Field(default="", max_length=120)
    justification: str = Field(default="", max_length=500)
    work_order_id: str | None = Field(default=None, max_length=36)

    @field_validator("department", "destination", "justification")
    @classmethod
    def trim_request_text(cls, value: str) -> str:
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


class LaundryCatalogItemPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=2, max_length=120)
    category: str = Field(min_length=2, max_length=80)
    unit: Literal["unidade", "kg", "pacote"] = "unidade"

    @field_validator("name", "category")
    @classmethod
    def trim_laundry_catalog_text(cls, value: str) -> str:
        normalized = value.strip()
        if len(normalized) < 2:
            raise ValueError("Informe pelo menos dois caracteres")
        return normalized


class LaundryRequestLinePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    item_id: str = Field(min_length=36, max_length=36)
    quantity: Decimal = Field(gt=0, le=999_999_999, max_digits=12, decimal_places=3)


class LaundryRequestCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    unit: str = Field(min_length=2, max_length=80)
    area: str = Field(min_length=2, max_length=120)
    description: str = Field(default="", max_length=500)
    priority: Literal["normal", "high", "urgent"] = "normal"
    items: list[LaundryRequestLinePayload] = Field(min_length=1, max_length=50)

    @field_validator("unit", "area", "description")
    @classmethod
    def trim_laundry_request_text(cls, value: str) -> str:
        return value.strip()

    @model_validator(mode="after")
    def reject_duplicate_laundry_items(self) -> "LaundryRequestCreate":
        item_ids = [item.item_id for item in self.items]
        if len(set(item_ids)) != len(item_ids):
            raise ValueError("Cada item deve aparecer uma única vez na solicitação")
        return self


class LaundryRequestUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["collected", "washing", "ready", "delivered", "cancelled"] | None = None
    assignee: str | None = Field(default=None, max_length=120)

    @field_validator("assignee")
    @classmethod
    def trim_laundry_assignee(cls, value: str | None) -> str | None:
        return value.strip() if value is not None else value

    @model_validator(mode="after")
    def require_laundry_request_change(self) -> "LaundryRequestUpdate":
        if self.status is None and self.assignee is None:
            raise ValueError("Informe uma alteração para a solicitação")
        return self


def _require_maintenance(principal: DemoPrincipal, action: str) -> None:
    if "maintenance" not in principal.modules or action not in principal.permissions.get("maintenance", []):
        raise HTTPException(status_code=403, detail="A fila e a atualização de ordens são restritas à equipe de manutenção")


def _serialize_order(order: WorkOrder) -> dict[str, object]:
    return {
        "id": order.id,
        "order_number": (
            f"{order.service_number_id:07d}" if order.service_number_id else ""
        ),
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


def _new_service_request_number(db: Session, issued_at: datetime) -> int:
    number = ServiceRequestNumber(issued_at=issued_at)
    db.add(number)
    db.flush()
    if number.id > 9_999_999:
        raise HTTPException(
            status_code=503,
            detail="A sequência de ordens de serviço atingiu o limite de sete dígitos",
        )
    return number.id


@app.get("/health")
def health() -> dict[str, str]:
    return {"service": "maintenance", "status": "ok"}


def _serialize_laundry_item(item: LaundryCatalogItem) -> dict[str, object]:
    return {
        "id": item.id,
        "name": item.name,
        "category": item.category,
        "unit": item.unit,
        "created_by": item.created_by,
        "created_at": item.created_at.isoformat(),
        "updated_at": item.updated_at.isoformat(),
    }


def _serialize_laundry_request(
    request: LaundryRequest, items: list[LaundryRequestItem]
) -> dict[str, object]:
    return {
        "id": request.id,
        "request_number": f"{request.request_number:07d}",
        "unit": request.unit,
        "area": request.area,
        "description": request.description,
        "priority": request.priority,
        "status": request.status,
        "assignee": request.assignee,
        "requester_name": request.requester_name,
        "updated_by": request.updated_by,
        "created_at": request.created_at.isoformat(),
        "updated_at": request.updated_at.isoformat(),
        "items": [
            {
                "item_id": line.item_id,
                "name": line.item.name,
                "category": line.item.category,
                "unit": line.item.unit,
                "quantity": str(line.quantity),
            }
            for line in items
        ],
    }


def _laundry_request_lines(
    db: Session, request_id: str
) -> list[LaundryRequestItem]:
    return db.scalars(
        select(LaundryRequestItem)
        .where(LaundryRequestItem.request_id == request_id)
        .order_by(LaundryCatalogItem.name)
        .join(LaundryCatalogItem)
    ).all()


def _require_laundry_write(principal: DemoPrincipal, action: str) -> None:
    if principal.is_superuser:
        return
    if any(
        module in principal.modules and action in principal.permissions.get(module, [])
        for module in ("laundry", "management", "admin")
    ):
        return
    raise HTTPException(
        status_code=403, detail="Acesso não autorizado para a Lavanderia/Rouparia"
    )


@app.get("/api/v1/laundry/items")
def list_laundry_items(
    principal: Annotated[
        DemoPrincipal, Depends(require_demo_role_or_superuser("laundry", "management", "admin", "oversight"))
    ],
    db: Annotated[Session, Depends(get_maintenance_db)],
) -> dict[str, list[dict[str, object]]]:
    items = db.scalars(select(LaundryCatalogItem).order_by(LaundryCatalogItem.name)).all()
    emit_audit_event(principal, "laundry", "laundry_catalog_read", "all")
    return {"items": [_serialize_laundry_item(item) for item in items]}


@app.post("/api/v1/laundry/items", status_code=201)
def create_laundry_item(
    payload: LaundryCatalogItemPayload,
    principal: Annotated[DemoPrincipal, AUTHENTICATED],
    db: Annotated[Session, Depends(get_maintenance_db)],
) -> dict[str, object]:
    _require_laundry_write(principal, "criar")
    duplicate = db.scalar(
        select(LaundryCatalogItem).where(
            func.lower(LaundryCatalogItem.name) == payload.name.casefold()
        )
    )
    if duplicate is not None:
        raise HTTPException(status_code=409, detail="Já existe um item com esse nome")
    now = datetime.now(UTC)
    item = LaundryCatalogItem(
        id=str(uuid.uuid4()),
        **payload.model_dump(),
        created_by=principal.actor_name,
        created_at=now,
        updated_at=now,
    )
    db.add(item)
    emit_audit_event(principal, "laundry", "laundry_catalog_item_created", item.id, db=db)
    db.commit()
    db.refresh(item)
    return _serialize_laundry_item(item)


@app.patch("/api/v1/laundry/items/{item_id}")
def update_laundry_item(
    item_id: str,
    payload: LaundryCatalogItemPayload,
    principal: Annotated[DemoPrincipal, AUTHENTICATED],
    db: Annotated[Session, Depends(get_maintenance_db)],
) -> dict[str, object]:
    _require_laundry_write(principal, "alterar")
    item = db.get(LaundryCatalogItem, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Item da lavanderia não encontrado")
    duplicate = db.scalar(
        select(LaundryCatalogItem).where(
            func.lower(LaundryCatalogItem.name) == payload.name.casefold(),
            LaundryCatalogItem.id != item_id,
        )
    )
    if duplicate is not None:
        raise HTTPException(status_code=409, detail="Já existe um item com esse nome")
    for field, value in payload.model_dump().items():
        setattr(item, field, value)
    item.updated_at = datetime.now(UTC)
    emit_audit_event(principal, "laundry", "laundry_catalog_item_updated", item.id, db=db)
    db.commit()
    db.refresh(item)
    return _serialize_laundry_item(item)


@app.delete("/api/v1/laundry/items/{item_id}", status_code=204)
def delete_laundry_item(
    item_id: str,
    principal: Annotated[DemoPrincipal, AUTHENTICATED],
    db: Annotated[Session, Depends(get_maintenance_db)],
) -> None:
    _require_laundry_write(principal, "excluir")
    item = db.get(LaundryCatalogItem, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Item da lavanderia não encontrado")
    if db.scalar(
        select(LaundryRequestItem.id).where(LaundryRequestItem.item_id == item_id).limit(1)
    ) is not None:
        raise HTTPException(
            status_code=409,
            detail="O item possui histórico de solicitações e não pode ser excluído",
        )
    if db.scalar(
        select(LaundryInventoryMovement.id)
        .where(LaundryInventoryMovement.item_id == item_id)
        .limit(1)
    ) is not None:
        raise HTTPException(
            status_code=409,
            detail="O item possui movimentações de estoque e não pode ser excluído",
        )
    emit_audit_event(principal, "laundry", "laundry_catalog_item_deleted", item.id, db=db)
    db.delete(item)
    db.commit()


@app.get("/api/v1/laundry/requests")
def list_laundry_requests(
    principal: Annotated[
        DemoPrincipal, Depends(require_demo_role_or_superuser("laundry", "management", "admin", "oversight"))
    ],
    db: Annotated[Session, Depends(get_maintenance_db)],
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> dict[str, object]:
    query = select(LaundryRequest)
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    requests = db.scalars(
        query.order_by(LaundryRequest.created_at.desc(), LaundryRequest.id.desc())
        .offset(offset)
        .limit(limit)
    ).all()
    emit_audit_event(principal, "laundry", "laundry_requests_read", "all")
    return {
        "requests": [
            _serialize_laundry_request(request, _laundry_request_lines(db, request.id))
            for request in requests
        ],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@app.post("/api/v1/laundry/requests", status_code=201)
def create_laundry_request(
    payload: LaundryRequestCreate,
    principal: Annotated[DemoPrincipal, AUTHENTICATED],
    db: Annotated[Session, Depends(get_maintenance_db)],
) -> dict[str, object]:
    _require_laundry_write(principal, "criar")
    items_by_id = {
        item.id: item
        for item in db.scalars(
            select(LaundryCatalogItem).where(
                LaundryCatalogItem.id.in_([line.item_id for line in payload.items])
            )
        ).all()
    }
    if len(items_by_id) != len(payload.items):
        raise HTTPException(
            status_code=422, detail="A solicitação contém itens inexistentes"
        )
    now = datetime.now(UTC)
    request = LaundryRequest(
        id=str(uuid.uuid4()),
        request_number=_new_service_request_number(db, now),
        unit=payload.unit,
        area=payload.area,
        description=payload.description,
        priority=payload.priority,
        status="open",
        assignee="",
        requester_id=principal.user_id,
        requester_name=principal.actor_name,
        updated_by=principal.actor_name,
        created_at=now,
        updated_at=now,
    )
    db.add(request)
    db.flush()
    lines = [
        LaundryRequestItem(
            id=str(uuid.uuid4()),
            request_id=request.id,
            item_id=line.item_id,
            quantity=line.quantity,
        )
        for line in payload.items
    ]
    db.add_all(lines)
    emit_audit_event(
        principal, "laundry", "laundry_request_created", request.id, db=db
    )
    db.commit()
    for line in lines:
        db.refresh(line)
    db.refresh(request)
    return _serialize_laundry_request(request, _laundry_request_lines(db, request.id))


@app.patch("/api/v1/laundry/requests/{request_id}")
def update_laundry_request(
    request_id: str,
    payload: LaundryRequestUpdate,
    principal: Annotated[DemoPrincipal, AUTHENTICATED],
    db: Annotated[Session, Depends(get_maintenance_db)],
) -> dict[str, object]:
    _require_laundry_write(principal, "alterar")
    request = db.get(LaundryRequest, request_id)
    if request is None:
        raise HTTPException(status_code=404, detail="Solicitação de lavanderia não encontrada")
    changes = payload.model_dump(exclude_unset=True, exclude_none=True)
    next_status = changes.get("status")
    transitions = {
        "open": {"collected", "cancelled"},
        "collected": {"washing"},
        "washing": {"ready"},
        "ready": {"delivered"},
        "delivered": set(),
        "cancelled": set(),
    }
    if next_status is not None and next_status != request.status:
        if next_status not in transitions[request.status]:
            raise HTTPException(
                status_code=409,
                detail="Etapa inválida; siga a sequência coleta, lavagem, pronto e devolvido",
            )
        lines = _laundry_request_lines(db, request.id)
        movement_types = {
            "collected": ("soiled_received",),
            "ready": ("soiled_processed", "clean_received"),
            "delivered": ("clean_delivered",),
        }.get(next_status, ())
        now = datetime.now(UTC)
        db.add_all(
            LaundryInventoryMovement(
                item_id=line.item_id,
                request_id=request.id,
                unit=request.unit,
                movement_type=movement_type,
                quantity=line.quantity,
                actor_id=principal.user_id,
                actor_name=principal.actor_name,
                created_at=now,
            )
            for line in lines
            for movement_type in movement_types
        )
        request.status = next_status
    if "assignee" in changes:
        request.assignee = changes["assignee"]
    request.updated_by = principal.actor_name
    request.updated_at = datetime.now(UTC)
    emit_audit_event(
        principal, "laundry", "laundry_request_updated", request.id, db=db
    )
    db.commit()
    db.refresh(request)
    return _serialize_laundry_request(request, _laundry_request_lines(db, request.id))


@app.get("/api/v1/laundry/reports")
def get_laundry_reports(
    principal: Annotated[
        DemoPrincipal, Depends(require_demo_role_or_superuser("laundry", "management", "admin", "oversight"))
    ],
    db: Annotated[Session, Depends(get_maintenance_db)],
) -> dict[str, object]:
    balances: dict[str, dict[str, Decimal]] = {}
    rows = db.execute(
        select(
            LaundryInventoryMovement.item_id,
            LaundryInventoryMovement.movement_type,
            func.sum(LaundryInventoryMovement.quantity),
        ).group_by(
            LaundryInventoryMovement.item_id, LaundryInventoryMovement.movement_type
        )
    )
    for item_id, movement_type, total in rows:
        values = balances.setdefault(item_id, {"clean": Decimal(0), "soiled": Decimal(0)})
        if movement_type == "soiled_received":
            values["soiled"] += Decimal(total or 0)
        elif movement_type == "soiled_processed":
            values["soiled"] -= Decimal(total or 0)
        elif movement_type == "clean_received":
            values["clean"] += Decimal(total or 0)
        elif movement_type == "clean_delivered":
            values["clean"] -= Decimal(total or 0)
    items = db.scalars(select(LaundryCatalogItem).order_by(LaundryCatalogItem.name)).all()
    status_counts = {
        status: db.scalar(
            select(func.count()).select_from(LaundryRequest).where(
                LaundryRequest.status == status
            )
        ) or 0
        for status in ("open", "collected", "washing", "ready", "delivered", "cancelled")
    }
    movements = db.scalars(
        select(LaundryInventoryMovement)
        .order_by(
            LaundryInventoryMovement.created_at.desc(),
            LaundryInventoryMovement.id.desc(),
        )
        .limit(100)
    ).all()
    emit_audit_event(principal, "laundry", "laundry_reports_read", "all")
    return {
        "items": [
            {
                **_serialize_laundry_item(item),
                "clean_balance": str(balances.get(item.id, {}).get("clean", Decimal(0))),
                "soiled_balance": str(balances.get(item.id, {}).get("soiled", Decimal(0))),
            }
            for item in items
        ],
        "status_counts": status_counts,
        "movements": [
            {
                "id": movement.id,
                "item_id": movement.item_id,
                "item_name": movement.item.name,
                "request_id": movement.request_id,
                "unit": movement.unit,
                "movement_type": movement.movement_type,
                "quantity": str(movement.quantity),
                "actor_name": movement.actor_name,
                "created_at": movement.created_at.isoformat(),
            }
            for movement in movements
        ],
    }


@app.post("/api/v1/maintenance/orders", status_code=201)
def create_order(
    payload: WorkOrderCreate,
    principal: Annotated[DemoPrincipal, AUTHENTICATED],
    db: Annotated[Session, Depends(get_maintenance_db)],
) -> dict[str, object]:
    patient_reference = payload.patient_reference
    if payload.patient_reference:
        patient_reference = verify_patient_reference(payload.patient_reference)["reference"]
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
        service_number_id=_new_service_request_number(db, now),
        **payload.model_dump(exclude={"asset_tag", "asset_id", "patient_reference"}),
        patient_reference=patient_reference,
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
    from_at: datetime | None = None,
    to_at: datetime | None = None,
    service_type: str | None = Query(default=None, max_length=80),
    department: str | None = Query(default=None, max_length=100),
    status: Literal["open", "in_progress", "completed", "cancelled"] | None = None,
    priority: Literal["normal", "high", "urgent"] | None = None,
    q: str | None = Query(default=None, max_length=120),
) -> dict[str, list[dict[str, object]]]:
    if not any(
        module in principal.modules and "consultar" in principal.permissions.get(module, [])
        for module in ("maintenance", "management", "admin", "oversight")
    ):
        raise HTTPException(status_code=403, detail="Acesso de consulta à fila de manutenção não autorizado")
    if (from_at or to_at) and (from_date or to_date):
        raise HTTPException(status_code=422, detail="Use datas ou data e hora, não ambos os formatos")
    if any(value and (value.tzinfo is None or value.utcoffset() is None) for value in (from_at, to_at)):
        raise HTTPException(status_code=422, detail="Informe data e hora com fuso horário")
    if from_at and to_at and to_at < from_at:
        raise HTTPException(status_code=422, detail="A data e hora inicial deve ser anterior ou igual à final")
    if from_date and to_date and from_date > to_date:
        raise HTTPException(status_code=422, detail="A data inicial deve ser anterior à data final")
    query = select(WorkOrder)
    if from_at:
        query = query.where(WorkOrder.created_at >= from_at.astimezone(UTC))
    elif from_date:
        query = query.where(WorkOrder.created_at >= datetime.combine(from_date, time.min, tzinfo=UTC))
    if to_at:
        query = query.where(WorkOrder.created_at <= to_at.astimezone(UTC))
    elif to_date:
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


def _serialize_warehouse_item(item: WarehouseItem) -> dict[str, object]:
    return {
        "id": item.id,
        "name": item.name,
        "category": item.category,
        "unit": item.unit,
        "location": item.location,
        "barcode": item.barcode,
        "lot": item.lot,
        "expiry_date": item.expiry_date.isoformat() if item.expiry_date else None,
        "serial_number": item.serial_number,
        "balance": float(item.balance),
        "minimum_balance": float(item.minimum_balance),
        "active": item.active,
        "created_by": item.created_by,
        "created_at": item.created_at.isoformat(),
        "updated_at": item.updated_at.isoformat(),
    }


def _serialize_warehouse_movement(movement: WarehouseMovement, item_name: str) -> dict[str, object]:
    return {
        "id": movement.id,
        "item_id": movement.item_id,
        "item_name": item_name,
        "movement_type": movement.movement_type,
        "quantity": float(movement.quantity),
        "balance_after": float(movement.balance_after),
        "reason": movement.reason,
        "destination": movement.destination,
        "work_order_id": movement.work_order_id,
        "actor_name": movement.actor_name,
        "created_at": movement.created_at.isoformat(),
    }


def _serialize_warehouse_request(request: WarehouseRequest, item_name: str, item_unit: str) -> dict[str, object]:
    return {
        "id": request.id,
        "item_id": request.item_id,
        "item_name": item_name,
        "item_unit": item_unit,
        "quantity": float(request.quantity),
        "department": request.department,
        "destination": request.destination,
        "justification": request.justification,
        "work_order_id": request.work_order_id,
        "status": request.status,
        "requester_name": request.requester_name,
        "updated_by": request.updated_by,
        "created_at": request.created_at.isoformat(),
        "updated_at": request.updated_at.isoformat(),
    }


@app.get("/api/v1/warehouse/items")
def list_warehouse_items(
    principal: Annotated[DemoPrincipal, Depends(require_demo_role_or_superuser("warehouse", "maintenance", "management"))],
    db: Annotated[Session, Depends(get_maintenance_db)],
) -> dict[str, list[dict[str, object]]]:
    items = db.scalars(select(WarehouseItem).order_by(WarehouseItem.active.desc(), WarehouseItem.name)).all()
    emit_audit_event(principal, "warehouse", "warehouse_items_read", "all", db=db)
    return {"items": [_serialize_warehouse_item(item) for item in items]}


@app.post("/api/v1/warehouse/items", status_code=201)
def create_warehouse_item(
    payload: WarehouseItemPayload,
    principal: Annotated[DemoPrincipal, Depends(require_demo_role_or_superuser("warehouse", "maintenance", "management"))],
    db: Annotated[Session, Depends(get_maintenance_db)],
) -> dict[str, object]:
    now = datetime.now(UTC)
    item = WarehouseItem(
        id=str(uuid.uuid4()),
        name=payload.name,
        category=payload.category,
        unit=payload.unit,
        location=payload.location,
        barcode=payload.barcode,
        lot=payload.lot,
        expiry_date=payload.expiry_date,
        serial_number=payload.serial_number,
        balance=payload.balance,
        minimum_balance=payload.minimum_balance,
        active=payload.active,
        created_by=principal.actor_name,
        created_at=now,
        updated_at=now,
    )
    db.add(item)
    emit_audit_event(principal, "warehouse", "warehouse_item_created", item.id, db=db)
    db.commit()
    db.refresh(item)
    return _serialize_warehouse_item(item)


@app.post("/api/v1/warehouse/items/{item_id}/movements", status_code=201)
def create_warehouse_movement(
    item_id: str,
    payload: WarehouseMovementPayload,
    principal: Annotated[DemoPrincipal, Depends(require_demo_role_or_superuser("warehouse", "maintenance", "management"))],
    db: Annotated[Session, Depends(get_maintenance_db)],
) -> dict[str, object]:
    item = db.get(WarehouseItem, item_id)
    if item is None or not item.active:
        raise HTTPException(status_code=404, detail="Item não encontrado")

    current = Decimal(str(item.balance or 0))
    quantity = payload.quantity
    if payload.movement_type in {"entry", "return"}:
        balance_after = current + quantity
    elif payload.movement_type == "adjustment":
        balance_after = quantity
    else:
        if quantity > current:
            raise HTTPException(status_code=409, detail="Saldo insuficiente para esta movimentação")
        balance_after = current - quantity

    now = datetime.now(UTC)
    item.balance = balance_after
    item.updated_at = now
    movement = WarehouseMovement(
        item_id=item.id,
        movement_type=payload.movement_type,
        quantity=quantity,
        balance_after=balance_after,
        reason=payload.reason,
        destination=payload.destination,
        work_order_id=payload.work_order_id,
        actor_id=principal.actor_id,
        actor_name=principal.actor_name,
        created_at=now,
    )
    db.add(movement)
    emit_audit_event(principal, "warehouse", "warehouse_movement_created", item.id, db=db)
    db.commit()
    db.refresh(movement)
    return _serialize_warehouse_movement(movement, item.name)


@app.get("/api/v1/warehouse/movements")
def list_warehouse_movements(
    principal: Annotated[DemoPrincipal, Depends(require_demo_role_or_superuser("warehouse", "maintenance", "management"))],
    db: Annotated[Session, Depends(get_maintenance_db)],
) -> dict[str, list[dict[str, object]]]:
    rows = db.execute(
        select(WarehouseMovement, WarehouseItem.name)
        .join(WarehouseItem, WarehouseItem.id == WarehouseMovement.item_id)
        .order_by(WarehouseMovement.created_at.desc())
        .limit(500)
    ).all()
    emit_audit_event(principal, "warehouse", "warehouse_movements_read", "all", db=db)
    return {"movements": [_serialize_warehouse_movement(movement, name) for movement, name in rows]}


@app.get("/api/v1/warehouse/requests")
def list_warehouse_requests(
    principal: Annotated[DemoPrincipal, Depends(require_demo_role_or_superuser("warehouse", "maintenance", "management"))],
    db: Annotated[Session, Depends(get_maintenance_db)],
) -> dict[str, list[dict[str, object]]]:
    rows = db.execute(
        select(WarehouseRequest, WarehouseItem.name, WarehouseItem.unit)
        .join(WarehouseItem, WarehouseItem.id == WarehouseRequest.item_id)
        .order_by(WarehouseRequest.created_at.desc())
    ).all()
    emit_audit_event(principal, "warehouse", "warehouse_requests_read", "all", db=db)
    return {"requests": [_serialize_warehouse_request(request, name, unit) for request, name, unit in rows]}


@app.post("/api/v1/warehouse/requests", status_code=201)
def create_warehouse_request(
    payload: WarehouseRequestPayload,
    principal: Annotated[DemoPrincipal, Depends(require_demo_role_or_superuser("warehouse", "maintenance", "management"))],
    db: Annotated[Session, Depends(get_maintenance_db)],
) -> dict[str, object]:
    item = db.get(WarehouseItem, payload.item_id)
    if item is None or not item.active:
        raise HTTPException(status_code=404, detail="Item não encontrado")
    now = datetime.now(UTC)
    request = WarehouseRequest(
        id=str(uuid.uuid4()),
        item_id=item.id,
        quantity=payload.quantity,
        department=payload.department,
        destination=payload.destination,
        justification=payload.justification,
        work_order_id=payload.work_order_id,
        status="pending",
        requester_id=principal.actor_id,
        requester_name=principal.actor_name,
        updated_by=principal.actor_name,
        created_at=now,
        updated_at=now,
    )
    db.add(request)
    emit_audit_event(principal, "warehouse", "warehouse_request_created", request.id, db=db)
    db.commit()
    db.refresh(request)
    return _serialize_warehouse_request(request, item.name, item.unit)


@app.patch("/api/v1/warehouse/requests/{request_id}")
def update_warehouse_request(
    request_id: str,
    payload: dict[str, str],
    principal: Annotated[DemoPrincipal, Depends(require_demo_role_or_superuser("warehouse", "maintenance", "management"))],
    db: Annotated[Session, Depends(get_maintenance_db)],
) -> dict[str, object]:
    request = db.get(WarehouseRequest, request_id)
    if request is None:
        raise HTTPException(status_code=404, detail="Solicitação não encontrada")
    status = payload.get("status")
    if status not in {"cancelled", "fulfilled"}:
        raise HTTPException(status_code=422, detail="Status inválido")
    if request.status != "pending":
        raise HTTPException(status_code=409, detail="Solicitação já foi finalizada")

    now = datetime.now(UTC)
    item = db.get(WarehouseItem, request.item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Item não encontrado")
    if status == "fulfilled":
        quantity = Decimal(str(request.quantity))
        current = Decimal(str(item.balance or 0))
        if quantity > current:
            raise HTTPException(status_code=409, detail="Saldo insuficiente para atender a solicitação")
        item.balance = current - quantity
        item.updated_at = now
        movement = WarehouseMovement(
            item_id=item.id,
            movement_type="issue",
            quantity=quantity,
            balance_after=item.balance,
            reason=f"Atendimento da solicitação {request.id}",
            destination=request.destination or request.department,
            work_order_id=request.work_order_id,
            actor_id=principal.actor_id,
            actor_name=principal.actor_name,
            created_at=now,
        )
        db.add(movement)

    request.status = status
    request.updated_by = principal.actor_name
    request.updated_at = now
    emit_audit_event(principal, "warehouse", "warehouse_request_updated", request.id, db=db)
    db.commit()
    db.refresh(request)
    return _serialize_warehouse_request(request, item.name, item.unit)


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
