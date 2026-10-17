from contextlib import asynccontextmanager
from datetime import UTC, date, datetime
from decimal import Decimal, InvalidOperation
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, func, select
from sqlalchemy.orm import Mapped, Session, mapped_column

from .common import (
    Base,
    DemoPrincipal,
    database_session,
    emit_audit_event,
    require_demo_role,
    verify_database_migrated,
)


class InventoryItem(Base):
    __tablename__ = "inventory_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    item_name: Mapped[str] = mapped_column(String(120), nullable=False)
    balance: Mapped[str] = mapped_column(String(32), nullable=False)
    unit: Mapped[str] = mapped_column(String(24), nullable=False)
    lot: Mapped[str] = mapped_column(String(80), nullable=False)
    expiry_date: Mapped[date] = mapped_column(Date, nullable=False)
    barcode: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    category: Mapped[str] = mapped_column(String(40), nullable=False, default="Medicamento")
    active_ingredient: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    presentation: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    supplier: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    storage_location: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    minimum_balance: Mapped[str] = mapped_column(String(32), nullable=False, default="0")
    average_balance: Mapped[str] = mapped_column(String(32), nullable=False, default="0")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )


class PharmacyStockMovement(Base):
    __tablename__ = "pharmacy_stock_movements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    item_id: Mapped[int] = mapped_column(
        ForeignKey("inventory_items.id", ondelete="RESTRICT"), nullable=False
    )
    movement_type: Mapped[str] = mapped_column(String(24), nullable=False)
    quantity: Mapped[str] = mapped_column(String(32), nullable=False)
    balance_after: Mapped[str] = mapped_column(String(32), nullable=False)
    reason: Mapped[str] = mapped_column(String(500), nullable=False)
    actor_id: Mapped[str] = mapped_column(String(36), nullable=False)
    actor_name: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


def get_pharmacy_db():
    yield from database_session("pharmacy")


@asynccontextmanager
async def lifespan(_: FastAPI):
    verify_database_migrated("pharmacy")
    yield


app = FastAPI(
    title="SCPO Connect · Serviço de Farmácia", version="1.0.0", lifespan=lifespan
)
PHARMACY_ROLE = require_demo_role("pharmacy")


class InventoryPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    item_name: str = Field(min_length=1, max_length=120)
    balance: str = Field(pattern=r"^\d{1,9}(?:[.,]\d{1,3})?$", max_length=32)
    unit: str = Field(min_length=1, max_length=24)
    lot: str = Field(min_length=1, max_length=80)
    expiry_date: date
    barcode: str = Field(default="", max_length=40)
    category: str = Field(default="Medicamento", min_length=2, max_length=40)
    active_ingredient: str = Field(default="", max_length=120)
    presentation: str = Field(default="", max_length=120)
    supplier: str = Field(default="", max_length=120)
    storage_location: str = Field(default="", max_length=80)
    minimum_balance: str = Field(default="0", pattern=r"^\d{1,9}(?:[.,]\d{1,3})?$", max_length=32)
    average_balance: str = Field(default="0", pattern=r"^\d{1,9}(?:[.,]\d{1,3})?$", max_length=32)


class StockThresholdPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    minimum_balance: str = Field(pattern=r"^\d{1,9}(?:[.,]\d{1,3})?$", max_length=32)
    average_balance: str = Field(pattern=r"^\d{1,9}(?:[.,]\d{1,3})?$", max_length=32)


class StockMovementPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    movement_type: Literal["entry", "issue", "adjustment"]
    quantity: str = Field(pattern=r"^-?\d{1,9}(?:[.,]\d{1,3})?$", max_length=32)
    reason: str = Field(min_length=3, max_length=500)

    @field_validator("reason")
    @classmethod
    def trim_reason(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 3:
            raise ValueError("Informe o motivo da movimentação")
        return value


def parse_stock_quantity(value: str) -> Decimal:
    try:
        number = Decimal(value.replace(",", "."))
    except InvalidOperation as exc:
        raise HTTPException(status_code=422, detail="Informe uma quantidade válida") from exc
    if not number.is_finite():
        raise HTTPException(status_code=422, detail="Informe uma quantidade válida")
    return number


def format_stock_quantity(value: Decimal) -> str:
    normalized = value.normalize()
    return format(normalized, "f")


@app.get("/health")
def health() -> dict[str, str]:
    return {"service": "pharmacy", "status": "ok"}


@app.get("/api/v1/pharmacy/items")
def list_items(
    principal: Annotated[DemoPrincipal, Depends(PHARMACY_ROLE)],
    db: Annotated[Session, Depends(get_pharmacy_db)],
) -> dict[str, list[dict[str, object]]]:
    items = [
            serialize_item(item)
            for item in db.scalars(
                select(InventoryItem).order_by(InventoryItem.item_name)
            ).all()
        ]
    emit_audit_event(principal, "pharmacy", "inventory_read", "inventory_items")
    return {"items": items}


@app.post("/api/v1/pharmacy/items", status_code=201)
def create_item(
    payload: InventoryPayload,
    principal: Annotated[DemoPrincipal, Depends(PHARMACY_ROLE)],
    db: Annotated[Session, Depends(get_pharmacy_db)],
) -> dict[str, object]:
    now = datetime.now(UTC)
    item = InventoryItem(**payload.model_dump(), created_at=now)
    db.add(item)
    db.flush()
    db.add(
        PharmacyStockMovement(
            item_id=item.id,
            movement_type="entry",
            quantity=format_stock_quantity(parse_stock_quantity(item.balance)),
            balance_after=item.balance,
            reason="Saldo inicial informado no cadastro do lote.",
            actor_id=principal.user_id,
            actor_name=principal.actor_name,
            created_at=now,
        )
    )
    db.commit()
    emit_audit_event(principal, "pharmacy", "inventory_item_created", str(item.id))
    return serialize_item(item)


@app.get("/api/v1/pharmacy/movements")
def list_stock_movements(
    principal: Annotated[DemoPrincipal, Depends(PHARMACY_ROLE)],
    db: Annotated[Session, Depends(get_pharmacy_db)],
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
    offset: Annotated[int, Query(ge=0)] = 0,
    item_id: int | None = None,
) -> dict[str, object]:
    query = select(PharmacyStockMovement)
    count_query = select(func.count(PharmacyStockMovement.id))
    if item_id is not None:
        query = query.where(PharmacyStockMovement.item_id == item_id)
        count_query = count_query.where(PharmacyStockMovement.item_id == item_id)
    movements = db.scalars(
        query.order_by(
            PharmacyStockMovement.created_at.desc(),
            PharmacyStockMovement.id.desc(),
        )
        .offset(offset)
        .limit(limit)
    ).all()
    total = db.scalar(count_query) or 0
    emit_audit_event(principal, "pharmacy", "stock_movements_read", str(item_id or "all"))
    return {
        "movements": [serialize_stock_movement(movement) for movement in movements],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@app.post("/api/v1/pharmacy/items/{item_id}/movements", status_code=201)
def create_stock_movement(
    item_id: int,
    payload: StockMovementPayload,
    principal: Annotated[DemoPrincipal, Depends(PHARMACY_ROLE)],
    db: Annotated[Session, Depends(get_pharmacy_db)],
) -> dict[str, object]:
    if payload.movement_type not in {"entry", "issue", "adjustment"}:
        raise HTTPException(status_code=422, detail="Tipo de movimentação inválido")
    item = db.scalar(
        select(InventoryItem).where(InventoryItem.id == item_id).with_for_update()
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Item de estoque não encontrado")
    amount = parse_stock_quantity(payload.quantity)
    if amount == 0:
        raise HTTPException(status_code=422, detail="A quantidade deve ser diferente de zero")
    if payload.movement_type in {"entry", "issue"} and amount < 0:
        raise HTTPException(status_code=422, detail="Informe uma quantidade positiva")
    delta = amount if payload.movement_type != "issue" else -amount
    current_balance = parse_stock_quantity(item.balance)
    new_balance = current_balance + delta
    if new_balance < 0:
        raise HTTPException(status_code=409, detail="A movimentação não pode deixar o saldo negativo")
    if new_balance > Decimal("999999999.999"):
        raise HTTPException(status_code=422, detail="O saldo excede o limite permitido")

    now = datetime.now(UTC)
    item.balance = format_stock_quantity(new_balance)
    movement = PharmacyStockMovement(
        item_id=item.id,
        movement_type=payload.movement_type,
        quantity=format_stock_quantity(delta),
        balance_after=item.balance,
        reason=payload.reason.strip(),
        actor_id=principal.user_id,
        actor_name=principal.actor_name,
        created_at=now,
    )
    db.add(movement)
    db.commit()
    db.refresh(movement)
    db.refresh(item)
    emit_audit_event(principal, "pharmacy", "stock_movement_created", str(item.id))
    return serialize_stock_movement(movement)


@app.patch("/api/v1/pharmacy/items/{item_id}/stock-thresholds")
def update_stock_thresholds(
    item_id: int,
    payload: StockThresholdPayload,
    principal: Annotated[DemoPrincipal, Depends(PHARMACY_ROLE)],
    db: Annotated[Session, Depends(get_pharmacy_db)],
) -> dict[str, object]:
    item = db.get(InventoryItem, item_id)
    if item is None:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="Item de estoque não encontrado")
    item.minimum_balance = payload.minimum_balance
    item.average_balance = payload.average_balance
    db.commit()
    db.refresh(item)
    emit_audit_event(principal, "pharmacy", "inventory_thresholds_updated", str(item.id))
    return serialize_item(item)


def serialize_item(item: InventoryItem) -> dict[str, object]:
    return {
        "id": item.id,
        "item_name": item.item_name,
        "balance": item.balance,
        "unit": item.unit,
        "lot": item.lot,
        "expiry_date": item.expiry_date.isoformat(),
        "created_at": item.created_at.isoformat(),
        "barcode": item.barcode,
        "category": item.category,
        "active_ingredient": item.active_ingredient,
        "presentation": item.presentation,
        "supplier": item.supplier,
        "storage_location": item.storage_location,
        "minimum_balance": item.minimum_balance,
        "average_balance": item.average_balance,
    }


def serialize_stock_movement(movement: PharmacyStockMovement) -> dict[str, object]:
    return {
        "id": movement.id,
        "item_id": movement.item_id,
        "movement_type": movement.movement_type,
        "quantity": movement.quantity,
        "balance_after": movement.balance_after,
        "reason": movement.reason,
        "actor_id": movement.actor_id,
        "actor_name": movement.actor_name,
        "created_at": movement.created_at.isoformat(),
    }
