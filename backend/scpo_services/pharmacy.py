from contextlib import asynccontextmanager
from datetime import UTC, date, datetime
from typing import Annotated

from fastapi import Depends, FastAPI
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import Date, DateTime, Integer, String, select
from sqlalchemy.orm import Mapped, Session, mapped_column

from .common import (
    Base,
    DemoPrincipal,
    database_session,
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
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )


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


@app.get("/health")
def health() -> dict[str, str]:
    return {"service": "pharmacy", "status": "ok"}


@app.get("/api/v1/pharmacy/items")
def list_items(
    _: Annotated[DemoPrincipal, Depends(PHARMACY_ROLE)],
    db: Annotated[Session, Depends(get_pharmacy_db)],
) -> dict[str, list[dict[str, object]]]:
    return {
        "items": [
            serialize_item(item)
            for item in db.scalars(
                select(InventoryItem).order_by(InventoryItem.item_name)
            ).all()
        ]
    }


@app.post("/api/v1/pharmacy/items", status_code=201)
def create_item(
    payload: InventoryPayload,
    _: Annotated[DemoPrincipal, Depends(PHARMACY_ROLE)],
    db: Annotated[Session, Depends(get_pharmacy_db)],
) -> dict[str, object]:
    item = InventoryItem(**payload.model_dump(), created_at=datetime.now(UTC))
    db.add(item)
    db.commit()
    db.refresh(item)
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
    }
