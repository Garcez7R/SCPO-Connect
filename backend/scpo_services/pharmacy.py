import asyncio
import calendar
import csv
import hashlib
import io
import logging
import os
import re
import uuid
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal, InvalidOperation
from email.utils import parsedate_to_datetime
from typing import Annotated, Literal, Self
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx
from fastapi import Depends, FastAPI, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    delete,
    func,
    insert,
    select,
    update,
)
from sqlalchemy.orm import Mapped, Session, joinedload, mapped_column, relationship
from sqlalchemy.exc import OperationalError

from .common import (
    Base,
    DemoPrincipal,
    audit_outbox_lifespan,
    database_session,
    emit_audit_event,
    get_engine,
    register_audit_outbox_status_route,
    require_demo_role,
    require_service_token,
    verify_database_migrated,
    verify_patient_reference,
)


class PharmacyProduct(Base):
    __tablename__ = "pharmacy_products"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    gtin: Mapped[str | None] = mapped_column(String(14), nullable=True, index=True)
    legacy_identifier: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    category: Mapped[str] = mapped_column(String(40), nullable=False)
    active_ingredient: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    presentation: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    unit: Mapped[str] = mapped_column(String(24), nullable=False)
    minimum_balance: Mapped[str] = mapped_column(String(32), nullable=False, default="0")
    average_balance: Mapped[str] = mapped_column(String(32), nullable=False, default="0")
    packaging_purchase_unit: Mapped[str] = mapped_column(
        String(24), nullable=False, default=""
    )
    packaging_levels: Mapped[list[dict[str, str]]] = mapped_column(
        JSON, nullable=False, default=list
    )
    metadata_source: Mapped[str] = mapped_column(String(16), nullable=False, default="manual")
    source_reference: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class PharmacyLocation(Base):
    __tablename__ = "pharmacy_locations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class AnvisaCatalogEntry(Base):
    __tablename__ = "anvisa_catalog_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    gtin: Mapped[str] = mapped_column(String(14), nullable=False, index=True)
    product_name: Mapped[str] = mapped_column(String(120), nullable=False)
    active_ingredient: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    presentation: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    manufacturer: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    registration: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    record_key: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    imported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    source_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AnvisaCatalogUpdateState(Base):
    __tablename__ = "anvisa_catalog_update_state"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    automatic_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    run_time: Mapped[str] = mapped_column(String(5), nullable=False, default="00:00")
    timezone_name: Mapped[str] = mapped_column(String(40), nullable=False, default="America/Sao_Paulo")
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_entry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_error: Mapped[str] = mapped_column(String(240), nullable=False, default="")


class InventoryLot(Base):
    __tablename__ = "inventory_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[int] = mapped_column(
        ForeignKey("pharmacy_products.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    location_id: Mapped[int | None] = mapped_column(
        ForeignKey("pharmacy_locations.id", ondelete="SET NULL"), nullable=True, index=True
    )
    balance: Mapped[str] = mapped_column(String(32), nullable=False)
    lot: Mapped[str] = mapped_column(String(80), nullable=False)
    expiry_date: Mapped[date] = mapped_column(Date, nullable=False)
    supplier: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    minimum_balance: Mapped[str] = mapped_column(String(32), nullable=False, default="0")
    average_balance: Mapped[str] = mapped_column(String(32), nullable=False, default="0")
    purchase_quantity: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    purchase_unit: Mapped[str] = mapped_column(String(24), nullable=False, default="")
    units_per_purchase_unit: Mapped[str] = mapped_column(String(32), nullable=False, default="1")
    packaging_levels: Mapped[list[dict[str, str]]] = mapped_column(
        JSON, nullable=False, default=list
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    product: Mapped[PharmacyProduct] = relationship()
    location: Mapped[PharmacyLocation | None] = relationship()


class PurchaseRequest(Base):
    __tablename__ = "purchase_requests"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    product_id: Mapped[int | None] = mapped_column(
        ForeignKey("pharmacy_products.id", ondelete="SET NULL"), nullable=True
    )
    item_name: Mapped[str] = mapped_column(String(120), nullable=False)
    category: Mapped[str] = mapped_column(String(40), nullable=False)
    active_ingredient: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    presentation: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    base_unit: Mapped[str] = mapped_column(String(24), nullable=False)
    purchase_quantity: Mapped[str] = mapped_column(String(32), nullable=False)
    purchase_unit: Mapped[str] = mapped_column(String(24), nullable=False)
    units_per_purchase_unit: Mapped[str] = mapped_column(String(32), nullable=False)
    packaging_levels: Mapped[list[dict[str, str]]] = mapped_column(
        JSON, nullable=False, default=list
    )
    received_quantity: Mapped[str] = mapped_column(String(32), nullable=False, default="0")
    supplier: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    quoted_unit_price: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    justification: Mapped[str] = mapped_column(String(500), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    requested_by: Mapped[str] = mapped_column(String(120), nullable=False)
    approved_by: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    received_by: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    product: Mapped[PharmacyProduct | None] = relationship()


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


DISPENSATION_MOVEMENT_REASON = "Dispensação vinculada ao paciente."


class MedicationDispense(Base):
    __tablename__ = "medication_dispensations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    patient_reference: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("inventory_items.id", ondelete="RESTRICT"), nullable=False)
    medication_name: Mapped[str] = mapped_column(String(120), nullable=False)
    quantity: Mapped[str] = mapped_column(String(32), nullable=False)
    unit: Mapped[str] = mapped_column(String(24), nullable=False)
    instructions: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    prescription_reference: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    prescriber_name: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    allergy_reviewed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="dispensed")
    actor_id: Mapped[str] = mapped_column(String(36), nullable=False)
    actor_name: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


def get_pharmacy_db():
    yield from database_session("pharmacy")


@asynccontextmanager
async def lifespan(_: FastAPI):
    verify_database_migrated("pharmacy")
    async with audit_outbox_lifespan("pharmacy"):
        task = asyncio.create_task(_run_automatic_anvisa_catalog_worker())
        try:
            yield
        finally:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass


app = FastAPI(
    title="SCPO Connect · Serviço de Farmácia", version="1.0.0", lifespan=lifespan
)
register_audit_outbox_status_route(app, "pharmacy")
PHARMACY_ROLE = require_demo_role("pharmacy")
INVENTORY_READ_ROLE = require_demo_role("pharmacy", "management")
STOCK_REPORT_ACCESS = require_demo_role("pharmacy", "management", "admin", "oversight")
DISPENSATION_READ_ROLE = require_demo_role("pharmacy", "nursing", "physician", "management", "admin", "oversight")
ANVISA_CMED_CATALOG_URL = "https://dados.anvisa.gov.br/dados/TA_PRECO_MEDICAMENTO.csv"
MAX_ANVISA_CATALOG_BYTES = 32 * 1024 * 1024
ANVISA_AUTO_UPDATE_LOCK = asyncio.Lock()
logger = logging.getLogger(__name__)


class PackagingLevel(BaseModel):
    model_config = ConfigDict(extra="forbid")
    unit: str = Field(min_length=1, max_length=24)
    units_per_parent: str = Field(
        pattern=r"^\d{1,9}(?:[.,]\d{1,3})?$", max_length=32
    )

    @field_validator("unit")
    @classmethod
    def trim_unit(cls, value: str) -> str:
        return value.strip()

    @field_validator("units_per_parent")
    @classmethod
    def validate_positive_factor(cls, value: str) -> str:
        if parse_stock_quantity(value) <= 0:
            raise ValueError("Cada fator de embalagem deve ser maior que zero")
        return value


class InventoryPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    item_name: str = Field(min_length=1, max_length=120)
    balance: str | None = Field(default=None, pattern=r"^\d{1,9}(?:[.,]\d{1,3})?$", max_length=32)
    purchase_quantity: str | None = Field(default=None, pattern=r"^\d{1,9}(?:[.,]\d{1,3})?$", max_length=32)
    purchase_unit: str = Field(default="", max_length=24)
    units_per_purchase_unit: str = Field(default="1", pattern=r"^\d{1,9}(?:[.,]\d{1,3})?$", max_length=32)
    packaging_levels: list["PackagingLevel"] | None = Field(default=None, max_length=5)
    unit: str = Field(min_length=1, max_length=24)
    lot: str = Field(min_length=1, max_length=80)
    expiry_date: date
    barcode: str = Field(default="", max_length=200)
    category: str = Field(default="Medicamento", min_length=2, max_length=40)
    active_ingredient: str = Field(default="", max_length=120)
    presentation: str = Field(default="", max_length=120)
    catalog_registration: str = Field(default="", max_length=32)
    pharmacy_registration_confirmed: bool = False
    supplier: str = Field(default="", max_length=120)
    storage_location: str = Field(default="", max_length=80)
    minimum_balance: str = Field(default="0", pattern=r"^\d{1,9}(?:[.,]\d{1,3})?$", max_length=32)
    average_balance: str = Field(default="0", pattern=r"^\d{1,9}(?:[.,]\d{1,3})?$", max_length=32)

    @model_validator(mode="after")
    def validate_quantity_conversion(self) -> "InventoryPayload":
        if not self.pharmacy_registration_confirmed:
            raise ValueError(
                "A pessoa responsável pela Farmácia deve conferir e confirmar os dados antes do cadastro"
            )
        if self.purchase_quantity:
            if not self.purchase_unit.strip():
                raise ValueError("Informe a unidade da embalagem recebida")
            quantity = parse_stock_quantity(self.purchase_quantity)
            if quantity <= 0:
                raise ValueError("Quantidade e fator de conversão devem ser maiores que zero")
            levels = normalized_packaging_levels(
                self.packaging_levels,
                self.purchase_unit,
                self.unit,
                self.units_per_purchase_unit,
            )
            factor = packaging_conversion_factor(levels)
            validate_base_stock_quantity(quantity * factor)
        elif self.balance is None:
            raise ValueError("Informe o saldo em unidade base ou a quantidade de embalagens recebidas")
        elif self.purchase_unit or self.units_per_purchase_unit != "1" or self.packaging_levels is not None:
            raise ValueError("Informe a quantidade comprada para converter embalagens")
        return self


def normalized_packaging_levels(
    levels: list[PackagingLevel] | None,
    purchase_unit: str,
    base_unit: str,
    legacy_factor: str,
) -> list[dict[str, str]]:
    resolved = levels or [
        PackagingLevel(unit=base_unit, units_per_parent=legacy_factor)
    ]
    unit_names = [level.unit.strip() for level in resolved]
    normalized_names = [name.casefold() for name in unit_names]
    if any(not name for name in unit_names):
        raise ValueError("Informe o nome de cada unidade da embalagem")
    if len(set(normalized_names)) != len(normalized_names):
        raise ValueError("Cada nível da embalagem deve ter uma unidade diferente")
    if purchase_unit.strip().casefold() in normalized_names and not (
        len(normalized_names) == 1
        and purchase_unit.strip().casefold() == base_unit.strip().casefold()
        and normalized_names[0] == base_unit.strip().casefold()
    ):
        raise ValueError("A unidade de compra não pode se repetir nos níveis internos")
    if unit_names[-1].casefold() != base_unit.strip().casefold():
        raise ValueError("O último nível da embalagem deve corresponder à unidade base do estoque")
    return [
        {
            "unit": level.unit.strip(),
            "units_per_parent": format_stock_quantity(
                parse_stock_quantity(level.units_per_parent)
            ),
        }
        for level in resolved
    ]


def packaging_conversion_factor(levels: list[dict[str, str]]) -> Decimal:
    factor = Decimal(1)
    for level in levels:
        factor *= parse_stock_quantity(level["units_per_parent"])
    return factor


def describe_packaging_conversion(
    purchase_quantity: str,
    purchase_unit: str,
    levels: list[dict[str, str]],
    base_quantity: str,
    base_unit: str,
) -> str:
    parts = [f"{purchase_quantity} {purchase_unit}"]
    parent_unit = purchase_unit
    for level in levels:
        parts.append(
            f"{level['units_per_parent']} {level['unit']} por {parent_unit}"
        )
        parent_unit = level["unit"]
    return f"{' × '.join(parts)} = {base_quantity} {base_unit}"


class PurchaseRequestPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    product_id: int | None = Field(default=None, gt=0)
    item_name: str = Field(min_length=2, max_length=120)
    category: str = Field(default="Medicamento", min_length=2, max_length=40)
    active_ingredient: str = Field(default="", max_length=120)
    presentation: str = Field(default="", max_length=120)
    base_unit: str = Field(min_length=1, max_length=24)
    purchase_quantity: str = Field(pattern=r"^\d{1,9}(?:[.,]\d{1,3})?$", max_length=32)
    purchase_unit: str = Field(min_length=1, max_length=24)
    units_per_purchase_unit: str = Field(pattern=r"^\d{1,9}(?:[.,]\d{1,3})?$", max_length=32)
    packaging_levels: list[PackagingLevel] | None = Field(default=None, max_length=5)
    justification: str = Field(min_length=5, max_length=500)

    @field_validator("item_name", "category", "active_ingredient", "presentation", "base_unit", "purchase_unit", "justification")
    @classmethod
    def trim_purchase_text(cls, value: str) -> str:
        return value.strip()

    @model_validator(mode="after")
    def validate_purchase_amount(self) -> "PurchaseRequestPayload":
        quantity = parse_stock_quantity(self.purchase_quantity)
        if quantity <= 0:
            raise ValueError("Quantidade e fator de conversão devem ser maiores que zero")
        levels = normalized_packaging_levels(
            self.packaging_levels,
            self.purchase_unit,
            self.base_unit,
            self.units_per_purchase_unit,
        )
        factor = packaging_conversion_factor(levels)
        validate_base_stock_quantity(quantity * factor)
        return self


class PurchaseRequestUpdatePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["quoted", "approved", "ordered", "rejected"]
    supplier: str = Field(default="", max_length=120)
    quoted_unit_price: str = Field(default="", pattern=r"^\d{1,9}(?:[.,]\d{1,2})?$", max_length=32)

    @field_validator("supplier")
    @classmethod
    def trim_supplier(cls, value: str) -> str:
        return value.strip()


class PurchaseReceiptPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lot: str = Field(min_length=1, max_length=80)
    expiry_date: date
    actual_purchase_quantity: str = Field(pattern=r"^\d{1,9}(?:[.,]\d{1,3})?$", max_length=32)
    storage_location: str = Field(default="", max_length=80)

    @field_validator("lot", "storage_location")
    @classmethod
    def trim_receipt_text(cls, value: str) -> str:
        return value.strip()

    @field_validator("actual_purchase_quantity")
    @classmethod
    def validate_receipt_amount(cls, value: str) -> str:
        if parse_stock_quantity(value) <= 0:
            raise ValueError("Informe uma quantidade recebida maior que zero")
        return value

class StockThresholdPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    minimum_balance: str = Field(pattern=r"^\d{1,9}(?:[.,]\d{1,3})?$", max_length=32)
    average_balance: str = Field(pattern=r"^\d{1,9}(?:[.,]\d{1,3})?$", max_length=32)

    @model_validator(mode="after")
    def validate_threshold_order(self) -> Self:
        if parse_stock_quantity(self.average_balance) <= parse_stock_quantity(self.minimum_balance):
            raise ValueError("A meta média deve ser maior que o saldo mínimo")
        return self


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
        if value == DISPENSATION_MOVEMENT_REASON:
            raise ValueError("Use a guia de Dispensação para registrar saídas vinculadas a pacientes")
        return value


class MedicationDispensePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    patient_reference: str = Field(min_length=1, max_length=36)
    item_id: int = Field(gt=0)
    quantity: str = Field(pattern=r"^\d{1,9}(?:[.,]\d{1,3})?$", max_length=32)
    instructions: str = Field(default="", max_length=500)
    prescription_reference: str = Field(min_length=2, max_length=80)
    prescriber_name: str = Field(min_length=2, max_length=120)
    allergy_reviewed: bool

    @field_validator("instructions", "prescription_reference", "prescriber_name")
    @classmethod
    def trim_instructions(cls, value: str) -> str:
        return value.strip()


def parse_stock_quantity(value: str) -> Decimal:
    try:
        number = Decimal(value.replace(",", "."))
    except InvalidOperation as exc:
        raise HTTPException(status_code=422, detail="Informe uma quantidade válida") from exc
    if not number.is_finite():
        raise HTTPException(status_code=422, detail="Informe uma quantidade válida")
    return number


def validate_base_stock_quantity(value: Decimal) -> None:
    normalized = value.normalize()
    if value > Decimal("999999999.999") or normalized.as_tuple().exponent < -3:
        raise ValueError(
            "A quantidade convertida deve caber no saldo, com no máximo três casas decimais"
        )


def format_stock_quantity(value: Decimal) -> str:
    normalized = value.normalize()
    return format(normalized, "f")


def normalize_gtin(value: str) -> str:
    code = value.strip()
    if len(code) not in {8, 12, 13, 14} or not code.isdigit():
        raise ValueError("O código não tem um formato GTIN reconhecido")
    body = code[:-1]
    weighted_sum = sum(
        int(digit) * (3 if position % 2 == 0 else 1)
        for position, digit in enumerate(reversed(body))
    )
    if (10 - weighted_sum % 10) % 10 != int(code[-1]):
        raise ValueError("O dígito verificador do GTIN é inválido")
    return code.zfill(14)


def _parse_gs1_expiry(value: str) -> date:
    if len(value) != 6 or not value.isdigit():
        raise ValueError("A validade GS1 deve conter seis dígitos (AAMMDD)")
    year, month, day = 2000 + int(value[:2]), int(value[2:4]), int(value[4:])
    if not 1 <= month <= 12 or day > calendar.monthrange(year, month)[1]:
        raise ValueError("A validade GS1 informada não existe")
    return date(year, month, calendar.monthrange(year, month)[1] if day == 0 else day)


def parse_gs1_barcode(value: str) -> dict[str, object]:
    code = value.strip()
    for prefix in ("]d2", "]C1", "]Q3"):
        if code.startswith(prefix):
            code = code[len(prefix):]
            break
    if not code:
        raise ValueError("Leia ou informe um código de barras")

    fields: dict[str, str] = {}
    if code.startswith("("):
        tokens = list(re.finditer(r"\((\d{2})\)", code))
        if not tokens or tokens[0].start() != 0:
            raise ValueError("O formato GS1 entre parênteses é inválido")
        supported = {"01", "10", "17", "21"}
        for index, token in enumerate(tokens):
            ai = token.group(1)
            if ai not in supported:
                raise ValueError(f"Identificador GS1 não suportado: {ai}")
            if ai in fields:
                raise ValueError(f"Identificador GS1 duplicado: {ai}")
            end = tokens[index + 1].start() if index + 1 < len(tokens) else len(code)
            field_value = code[token.end():end]
            if ai in {"01", "17"}:
                expected = 14 if ai == "01" else 6
                if len(field_value) != expected:
                    raise ValueError(f"O identificador GS1 {ai} exige {expected} caracteres")
            elif not field_value or len(field_value) > 20:
                raise ValueError(f"O identificador GS1 {ai} deve conter de 1 a 20 caracteres")
            fields[ai] = field_value
    elif code.isdigit() and len(code) in {8, 12, 13, 14}:
        fields["01"] = normalize_gtin(code)
    else:
        index = 0
        supported = {"01", "10", "17", "21"}
        while index < len(code):
            if code[index] == "\x1d":
                index += 1
                continue
            ai = code[index:index + 2]
            if ai not in supported:
                raise ValueError(f"Identificador GS1 não suportado ou separador ausente: {ai}")
            if ai in fields:
                raise ValueError(f"Identificador GS1 duplicado: {ai}")
            index += 2
            if ai in {"01", "17"}:
                length = 14 if ai == "01" else 6
                field_value = code[index:index + length]
                if len(field_value) != length or not field_value.isdigit():
                    raise ValueError(f"O identificador GS1 {ai} está incompleto ou inválido")
                index += length
            else:
                end = code.find("\x1d", index)
                if end == -1:
                    end = len(code)
                field_value = code[index:end]
                if not field_value or len(field_value) > 20:
                    raise ValueError(f"O identificador GS1 {ai} deve conter de 1 a 20 caracteres")
                index = end
            fields[ai] = field_value

    raw_gtin = fields.get("01")
    if raw_gtin is None:
        raise ValueError("O código GS1 não contém o GTIN (AI 01)")
    gtin = normalize_gtin(raw_gtin)
    expiry = _parse_gs1_expiry(fields["17"]) if "17" in fields else None
    return {
        "gtin": gtin,
        "lot": fields.get("10"),
        "expiry_date": expiry.isoformat() if expiry else None,
        "serial": fields.get("21"),
    }


def parse_anvisa_cmed_csv(
    content: bytes,
    imported_at: datetime,
    source_updated_at: datetime | None,
) -> list[dict[str, object]]:
    try:
        csv_text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        csv_text = content.decode("cp1252")
    try:
        delimiter = csv.Sniffer().sniff(csv_text[:8192], delimiters=";,\t").delimiter
    except csv.Error:
        delimiter = ";"
    reader = csv.DictReader(io.StringIO(csv_text), delimiter=delimiter)
    required_columns = {
        "EAN 1", "EAN 2", "EAN 3", "PRODUTO", "APRESENTAÇÃO",
        "SUBSTÂNCIA", "LABORATÓRIO", "REGISTRO",
    }
    if not reader.fieldnames:
        raise ValueError("O catálogo Anvisa está vazio ou não contém cabeçalho")
    reader.fieldnames = [name.strip().lstrip("\ufeff") for name in reader.fieldnames]
    if not required_columns.issubset(reader.fieldnames):
        raise ValueError("O arquivo Anvisa não tem as colunas esperadas para identificação de medicamentos")

    records: dict[str, dict[str, object]] = {}
    for row in reader:
        product_name = (row.get("PRODUTO") or "").strip()[:120]
        if not product_name:
            continue
        for column in ("EAN 1", "EAN 2", "EAN 3"):
            raw_gtin = (row.get(column) or "").strip()
            if not raw_gtin.isdigit():
                continue
            try:
                gtin = normalize_gtin(raw_gtin)
            except ValueError:
                continue
            record = {
                "gtin": gtin,
                "product_name": product_name,
                "active_ingredient": (row.get("SUBSTÂNCIA") or "").strip()[:120],
                "presentation": (row.get("APRESENTAÇÃO") or "").strip()[:120],
                "manufacturer": (row.get("LABORATÓRIO") or "").strip()[:120],
                "registration": (row.get("REGISTRO") or "").strip()[:32],
                "imported_at": imported_at,
                "source_updated_at": source_updated_at,
            }
            stable_fields = "\x1f".join(
                str(record[name])
                for name in (
                    "gtin",
                    "product_name",
                    "active_ingredient",
                    "presentation",
                    "manufacturer",
                    "registration",
                )
            )
            record["record_key"] = hashlib.sha256(stable_fields.encode("utf-8")).hexdigest()
            records[str(record["record_key"])] = record
    if not records:
        raise ValueError("O catálogo Anvisa não contém EANs válidos para importar")
    return list(records.values())


@app.get("/health")
def health() -> dict[str, str]:
    return {"service": "pharmacy", "status": "ok"}


@app.get("/api/v1/pharmacy/stock-alerts")
def list_stock_alerts(
    principal: Annotated[DemoPrincipal, Depends(STOCK_REPORT_ACCESS)],
    db: Annotated[Session, Depends(get_pharmacy_db)],
) -> dict[str, list[dict[str, object]]]:
    today = datetime.now(ZoneInfo("America/Sao_Paulo")).date()
    alerts: list[dict[str, object]] = []
    items = db.scalars(
        select(InventoryLot)
        .options(joinedload(InventoryLot.product), joinedload(InventoryLot.location))
        .order_by(InventoryLot.expiry_date, InventoryLot.id)
    ).all()
    lots_by_product: dict[int, list[InventoryLot]] = {}
    available_balance_by_product: dict[int, Decimal] = {}
    for item in items:
        lots_by_product.setdefault(item.product_id, []).append(item)
        if item.expiry_date >= today:
            available_balance_by_product[item.product_id] = (
                available_balance_by_product.get(item.product_id, Decimal(0))
                + parse_stock_quantity(item.balance)
            )

    stock_alert_lot_by_product: dict[int, tuple[int, Decimal, Decimal]] = {}
    for product_id, product_lots in lots_by_product.items():
        product = product_lots[0].product
        available_balance = available_balance_by_product.get(product_id, Decimal(0))
        minimum = parse_stock_quantity(product.minimum_balance)
        if available_balance <= minimum:
            stock_alert_lot_by_product[product_id] = (
                next(
                    (lot.id for lot in product_lots if lot.expiry_date >= today),
                    product_lots[0].id,
                ),
                available_balance,
                parse_stock_quantity(product.average_balance),
            )

    for item in items:
        days_to_expiry = (item.expiry_date - today).days
        kinds: list[str] = []
        product_stock_alert = stock_alert_lot_by_product.get(item.product_id)
        if product_stock_alert and item.id == product_stock_alert[0]:
            available_balance, average = product_stock_alert[1:]
            minimum = parse_stock_quantity(item.product.minimum_balance)
            kinds.append(
                "critical_stock"
                if available_balance <= 0
                else "below_minimum"
            )
        else:
            available_balance = available_balance_by_product.get(
                item.product_id, Decimal(0)
            )
            average = parse_stock_quantity(item.product.average_balance)
        if days_to_expiry < 0:
            kinds.append("expired")
        elif days_to_expiry <= 30:
            kinds.append("expiring")
        if not kinds:
            continue
        alerts.append(
            {
                "item_id": item.id,
                "item_name": item.product.name,
                "category": item.product.category,
                "balance": item.balance,
                "available_balance": format_stock_quantity(available_balance),
                "unit": item.product.unit,
                "minimum_balance": item.product.minimum_balance,
                "suggested_replenishment": format_stock_quantity(
                    max(average - available_balance, Decimal(0))
                ),
                "lot": item.lot,
                "expiry_date": item.expiry_date.isoformat(),
                "days_to_expiry": days_to_expiry,
                "storage_location": item.location.name if item.location else "",
                "alert_types": kinds,
            }
        )
    alerts.sort(key=lambda item: (0 if "critical_stock" in item["alert_types"] else 1, item["days_to_expiry"], str(item["item_name"]).casefold()))
    emit_audit_event(principal, "pharmacy", "critical_stock_alerts_read", "inventory_items")
    return {"alerts": alerts}


@app.get("/api/v1/pharmacy/items")
def list_items(
    principal: Annotated[DemoPrincipal, Depends(INVENTORY_READ_ROLE)],
    db: Annotated[Session, Depends(get_pharmacy_db)],
) -> dict[str, list[dict[str, object]]]:
    items = [
        serialize_item(item)
        for item in db.scalars(
            select(InventoryLot)
            .options(joinedload(InventoryLot.product), joinedload(InventoryLot.location))
            .join(PharmacyProduct)
            .order_by(PharmacyProduct.name, InventoryLot.expiry_date, InventoryLot.id)
        ).all()
    ]
    emit_audit_event(principal, "pharmacy", "inventory_read", "inventory_items")
    return {"items": items}


@app.get("/api/v1/pharmacy/catalog/anvisa/status")
def anvisa_catalog_status(
    principal: Annotated[DemoPrincipal, Depends(INVENTORY_READ_ROLE)],
    db: Annotated[Session, Depends(get_pharmacy_db)],
) -> dict[str, object]:
    count = db.scalar(select(func.count(AnvisaCatalogEntry.id))) or 0
    imported_at = db.scalar(select(func.max(AnvisaCatalogEntry.imported_at)))
    source_updated_at = db.scalar(select(func.max(AnvisaCatalogEntry.source_updated_at)))
    state = _get_anvisa_catalog_update_state(db)
    emit_audit_event(principal, "pharmacy", "anvisa_catalog_status_read", "anvisa_catalog_entries")
    return {
        "source": "Anvisa/CMED · lista pública de preços de medicamentos",
        "source_url": ANVISA_CMED_CATALOG_URL,
        "entry_count": count,
        "imported_at": imported_at.isoformat() if imported_at else None,
        "source_updated_at": source_updated_at.isoformat() if source_updated_at else None,
        "automatic_enabled": _anvisa_auto_update_enabled(),
        "automatic_run_time": _anvisa_auto_update_run_time(),
        "automatic_timezone": _anvisa_auto_update_timezone(),
        "automatic_last_attempt_at": state.last_attempt_at.isoformat() if state and state.last_attempt_at else None,
        "automatic_last_success_at": state.last_success_at.isoformat() if state and state.last_success_at else None,
        "automatic_last_entry_count": state.last_entry_count if state else 0,
        "automatic_last_error": state.last_error if state else "",
    }


def _anvisa_auto_update_enabled() -> bool:
    return os.getenv("SCPO_ANVISA_AUTO_UPDATE", "true").strip().lower() in {"1", "true", "yes", "on"}


def _anvisa_auto_update_timezone() -> str:
    return os.getenv("SCPO_ANVISA_UPDATE_TIMEZONE", "America/Sao_Paulo")


def _anvisa_auto_update_run_time() -> str:
    return os.getenv("SCPO_ANVISA_UPDATE_RUN_TIME", "00:00")


def _get_anvisa_catalog_update_state(db: Session) -> AnvisaCatalogUpdateState | None:
    try:
        return db.get(AnvisaCatalogUpdateState, 1)
    except OperationalError:
        db.rollback()
        return None


def _download_and_replace_anvisa_catalog(db: Session) -> dict[str, object]:
    try:
        with httpx.stream(
            "GET",
            ANVISA_CMED_CATALOG_URL,
            headers={"User-Agent": "SCPO-Connect/1.0 (medication GTIN lookup)"},
            timeout=60.0,
        ) as response:
            if response.status_code != 200:
                raise HTTPException(status_code=503, detail="A Anvisa não disponibilizou o catálogo agora")
            content_length = response.headers.get("Content-Length")
            if content_length and content_length.isdigit() and int(content_length) > MAX_ANVISA_CATALOG_BYTES:
                raise HTTPException(status_code=413, detail="O arquivo público da Anvisa excede o limite de importação configurado")
            chunks: list[bytes] = []
            total_bytes = 0
            for chunk in response.iter_bytes():
                total_bytes += len(chunk)
                if total_bytes > MAX_ANVISA_CATALOG_BYTES:
                    raise HTTPException(status_code=413, detail="O arquivo público da Anvisa excede o limite de importação configurado")
                chunks.append(chunk)
            content = b"".join(chunks)
            modified_header = response.headers.get("Last-Modified")
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=503, detail="Catálogo público da Anvisa indisponível no momento") from exc

    source_updated_at = None
    if modified_header:
        try:
            source_updated_at = parsedate_to_datetime(modified_header).astimezone(UTC)
        except (TypeError, ValueError, OverflowError):
            source_updated_at = None
    imported_at = datetime.now(UTC)
    try:
        records = parse_anvisa_cmed_csv(content, imported_at, source_updated_at)
    except (UnicodeDecodeError, csv.Error, ValueError) as exc:
        raise HTTPException(status_code=502, detail=f"Não foi possível interpretar o arquivo público da Anvisa: {exc}") from exc
    if not records:
        raise HTTPException(status_code=502, detail="O catálogo público não contém registros válidos")

    db.execute(delete(AnvisaCatalogEntry))
    for start in range(0, len(records), 1000):
        db.execute(insert(AnvisaCatalogEntry), records[start:start + 1000])
    db.commit()
    return {
        "entry_count": len(records),
        "imported_at": imported_at.isoformat(),
        "source_updated_at": source_updated_at.isoformat() if source_updated_at else None,
    }


def _automatic_refresh_anvisa_catalog() -> None:
    with Session(get_engine("pharmacy")) as db:
        state = _get_anvisa_catalog_update_state(db)
        if state is None:
            state = AnvisaCatalogUpdateState(
                id=1,
                automatic_enabled=_anvisa_auto_update_enabled(),
                run_time=_anvisa_auto_update_run_time(),
                timezone_name=_anvisa_auto_update_timezone(),
            )
            db.add(state)
            try:
                db.commit()
            except OperationalError:
                db.rollback()
                return
        attempted_at = datetime.now(UTC)
        state.last_attempt_at = attempted_at
        try:
            result = _download_and_replace_anvisa_catalog(db)
            state.last_success_at = attempted_at
            state.last_entry_count = int(result["entry_count"])
            state.last_error = ""
        except Exception as exc:
            db.rollback()
            state = _get_anvisa_catalog_update_state(db)
            if state is not None:
                state.last_attempt_at = attempted_at
                state.last_error = str(getattr(exc, "detail", exc))[:240]
                db.commit()
                logger.warning("Automatic Anvisa catalog update failed: %s", state.last_error)
            else:
                logger.warning("Automatic Anvisa catalog update failed: %s", getattr(exc, "detail", exc))
            return
        db.commit()


@app.post("/api/v1/pharmacy/catalog/anvisa/refresh")
def refresh_anvisa_catalog(
    principal: Annotated[DemoPrincipal, Depends(PHARMACY_ROLE)],
    db: Annotated[Session, Depends(get_pharmacy_db)],
) -> dict[str, object]:
    result = _download_and_replace_anvisa_catalog(db)
    emit_audit_event(
        principal,
        "pharmacy",
        "anvisa_catalog_refreshed",
        str(result["entry_count"]),
        db=db,
    )
    db.commit()
    state = _get_anvisa_catalog_update_state(db)
    return {
        "source": "Anvisa/CMED · lista pública de preços de medicamentos",
        "source_url": ANVISA_CMED_CATALOG_URL,
        "entry_count": result["entry_count"],
        "imported_at": result["imported_at"],
        "source_updated_at": result["source_updated_at"],
        "automatic_enabled": _anvisa_auto_update_enabled(),
        "automatic_run_time": _anvisa_auto_update_run_time(),
        "automatic_timezone": _anvisa_auto_update_timezone(),
        "automatic_last_attempt_at": state.last_attempt_at.isoformat() if state and state.last_attempt_at else None,
        "automatic_last_success_at": state.last_success_at.isoformat() if state and state.last_success_at else None,
        "automatic_last_entry_count": state.last_entry_count if state else 0,
        "automatic_last_error": state.last_error if state else "",
    }


async def _run_automatic_anvisa_catalog_worker() -> None:
    while True:
        try:
            if _anvisa_auto_update_enabled():
                timezone_name = _anvisa_auto_update_timezone()
                timezone = ZoneInfo(timezone_name)
                run_time_text = _anvisa_auto_update_run_time()
                run_hour, run_minute = (int(part) for part in run_time_text.split(":", 1))
                now = datetime.now(timezone)
                if (now.hour, now.minute) >= (run_hour, run_minute):
                    with Session(get_engine("pharmacy")) as db:
                        state = _get_anvisa_catalog_update_state(db)
                        if state is None:
                            state = AnvisaCatalogUpdateState(id=1)
                            db.add(state)
                            try:
                                db.commit()
                            except OperationalError:
                                db.rollback()
                                await asyncio.sleep(60)
                                continue
                        state.automatic_enabled = True
                        state.run_time = run_time_text
                        state.timezone_name = timezone_name
                        db.commit()
                        last_success_at = state.last_success_at
                        if last_success_at is not None and last_success_at.tzinfo is None:
                            last_success_at = last_success_at.replace(tzinfo=UTC)
                        last_attempt_at = state.last_attempt_at
                        if last_attempt_at is not None and last_attempt_at.tzinfo is None:
                            last_attempt_at = last_attempt_at.replace(tzinfo=UTC)
                        due = (
                            last_success_at is None
                            or last_success_at.astimezone(timezone).date() != now.date()
                        )
                        retry_allowed = (
                            last_attempt_at is None
                            or (datetime.now(UTC) - last_attempt_at).total_seconds() >= 30 * 60
                        )
                        if due and retry_allowed:
                            await asyncio.to_thread(_automatic_refresh_anvisa_catalog)
        except (ZoneInfoNotFoundError, ValueError, RuntimeError) as exc:
            logger.warning("Automatic Anvisa catalog scheduler configuration is invalid: %s", exc)
        except Exception:
            logger.exception("Automatic Anvisa catalog worker failed")
        await asyncio.sleep(60)


@app.get("/api/v1/pharmacy/items/lookup")
def lookup_item_by_barcode(
    principal: Annotated[DemoPrincipal, Depends(INVENTORY_READ_ROLE)],
    db: Annotated[Session, Depends(get_pharmacy_db)],
    code: str = Query(min_length=1, max_length=200),
) -> dict[str, object]:
    try:
        parsed = parse_gs1_barcode(code)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    gtin = str(parsed["gtin"])
    matches = [
        serialize_item(item)
        for item in db.scalars(
            select(InventoryLot)
            .options(joinedload(InventoryLot.product), joinedload(InventoryLot.location))
            .join(PharmacyProduct)
            .where(PharmacyProduct.gtin == gtin)
            .order_by(InventoryLot.expiry_date, InventoryLot.id)
        ).all()
    ]
    catalog_suggestions = [
        serialize_catalog_entry(entry)
        for entry in db.scalars(
            select(AnvisaCatalogEntry)
            .where(AnvisaCatalogEntry.gtin == gtin)
            .order_by(AnvisaCatalogEntry.product_name, AnvisaCatalogEntry.presentation)
            .limit(20)
        ).all()
    ]
    catalog_imported_at = db.scalar(select(func.max(AnvisaCatalogEntry.imported_at)))
    emit_audit_event(principal, "pharmacy", "inventory_gtin_lookup", gtin)
    return {
        "gtin": gtin,
        **parsed,
        "matches": matches,
        "catalog_suggestions": catalog_suggestions,
        "catalog_imported_at": catalog_imported_at.isoformat() if catalog_imported_at else None,
    }


@app.post("/api/v1/pharmacy/items", status_code=201)
def create_item(
    payload: InventoryPayload,
    principal: Annotated[DemoPrincipal, Depends(PHARMACY_ROLE)],
    db: Annotated[Session, Depends(get_pharmacy_db)],
) -> dict[str, object]:
    now = datetime.now(UTC)
    packaging_levels = normalized_packaging_levels(
        payload.packaging_levels,
        payload.purchase_unit or payload.unit,
        payload.unit,
        payload.units_per_purchase_unit,
    )
    if payload.purchase_quantity:
        received_quantity = parse_stock_quantity(payload.purchase_quantity)
        conversion_factor = packaging_conversion_factor(packaging_levels)
        base_balance = received_quantity * conversion_factor
        purchase_unit = payload.purchase_unit.strip()
        factor_text = format_stock_quantity(conversion_factor)
        purchase_quantity = format_stock_quantity(received_quantity)
    else:
        base_balance = parse_stock_quantity(payload.balance or "")
        purchase_unit = payload.unit.strip()
        factor_text = "1"
        purchase_quantity = format_stock_quantity(base_balance)
    try:
        parsed = parse_gs1_barcode(payload.barcode) if payload.barcode else None
    except ValueError:
        parsed = None
    gtin = str(parsed["gtin"]) if parsed else None
    candidates = (
        db.scalars(select(PharmacyProduct).where(PharmacyProduct.gtin == gtin)).all()
        if gtin
        else []
    )
    product = None
    if candidates:
        exact = [
            candidate for candidate in candidates
            if (
                candidate.name.casefold(),
                candidate.category.casefold(),
                candidate.active_ingredient.casefold(),
                candidate.presentation.casefold(),
                candidate.unit.casefold(),
            ) == (
                payload.item_name.strip().casefold(),
                payload.category.casefold(),
                payload.active_ingredient.strip().casefold(),
                payload.presentation.strip().casefold(),
                payload.unit.strip().casefold(),
            )
        ]
        if len(exact) == 1:
            product = exact[0]
        elif len(candidates) == 1:
            product = candidates[0]
        else:
            raise HTTPException(
                status_code=409,
                detail="Há cadastros divergentes para este GTIN. Revise e consolide o produto antes de incluir outro lote.",
            )

    if product is not None and (
        payload.packaging_levels is not None or not product.packaging_levels
    ):
        product.packaging_purchase_unit = payload.purchase_unit.strip()
        product.packaging_levels = packaging_levels
    if product is None:
        product = PharmacyProduct(
            gtin=gtin,
            legacy_identifier=payload.barcode[:40] if not gtin else "",
            name=payload.item_name.strip(),
            category=payload.category.strip(),
            active_ingredient=payload.active_ingredient.strip(),
            presentation=payload.presentation.strip(),
            unit=payload.unit.strip(),
            minimum_balance=payload.minimum_balance,
            average_balance=payload.average_balance,
            packaging_purchase_unit=payload.purchase_unit.strip(),
            packaging_levels=packaging_levels,
            metadata_source="manual",
            source_reference="",
            created_at=now,
        )
        if gtin and payload.catalog_registration:
            catalog_entry = db.scalar(
                select(AnvisaCatalogEntry)
                .where(
                    AnvisaCatalogEntry.gtin == gtin,
                    AnvisaCatalogEntry.registration == payload.catalog_registration,
                )
                .limit(1)
            )
            if catalog_entry:
                product.metadata_source = "anvisa"
                product.source_reference = catalog_entry.registration
        db.add(product)
        db.flush()

    location = None
    location_name = payload.storage_location.strip()
    if location_name:
        location = db.scalar(select(PharmacyLocation).where(PharmacyLocation.name == location_name))
        if location is None:
            location = PharmacyLocation(name=location_name, created_at=now)
            db.add(location)
            db.flush()

    item = InventoryLot(
        product_id=product.id,
        location_id=location.id if location else None,
        balance=format_stock_quantity(base_balance),
        lot=payload.lot.strip(),
        expiry_date=payload.expiry_date,
        supplier=payload.supplier.strip(),
        minimum_balance=payload.minimum_balance,
        average_balance=payload.average_balance,
        purchase_quantity=purchase_quantity,
        purchase_unit=purchase_unit,
        units_per_purchase_unit=factor_text,
        packaging_levels=packaging_levels,
        created_at=now,
    )
    db.add(item)
    db.flush()
    db.add(
        PharmacyStockMovement(
            item_id=item.id,
            movement_type="entry",
            quantity=format_stock_quantity(base_balance),
            balance_after=item.balance,
            reason=(
                f"Entrada calculada: {describe_packaging_conversion(purchase_quantity, purchase_unit, packaging_levels, item.balance, product.unit)}."
                if payload.purchase_quantity
                else "Saldo inicial informado em unidade de estoque."
            ),
            actor_id=principal.user_id,
            actor_name=principal.actor_name,
            created_at=now,
        )
    )
    emit_audit_event(
        principal, "pharmacy", "inventory_item_created", str(item.id), db=db
    )
    db.commit()
    return serialize_item(item)


@app.get("/api/v1/pharmacy/purchase-requests")
def list_purchase_requests(
    principal: Annotated[DemoPrincipal, Depends(require_demo_role("pharmacy", "management"))],
    db: Annotated[Session, Depends(get_pharmacy_db)],
) -> dict[str, list[dict[str, object]]]:
    requests = db.scalars(
        select(PurchaseRequest).order_by(
            PurchaseRequest.created_at.desc(), PurchaseRequest.id
        )
    ).all()
    emit_audit_event(principal, "pharmacy", "purchase_requests_read", "all")
    return {"requests": [serialize_purchase_request(item) for item in requests]}


@app.post("/api/v1/pharmacy/purchase-requests", status_code=201)
def create_purchase_request(
    payload: PurchaseRequestPayload,
    principal: Annotated[DemoPrincipal, Depends(require_demo_role("pharmacy", "management"))],
    db: Annotated[Session, Depends(get_pharmacy_db)],
) -> dict[str, object]:
    product = db.get(PharmacyProduct, payload.product_id) if payload.product_id else None
    if payload.product_id and product is None:
        raise HTTPException(status_code=404, detail="Produto não encontrado no catálogo da Farmácia")
    if product and payload.base_unit.casefold() != product.unit.casefold():
        raise HTTPException(status_code=409, detail="A unidade base deve corresponder ao catálogo do produto")
    packaging_levels = normalized_packaging_levels(
        payload.packaging_levels,
        payload.purchase_unit,
        payload.base_unit,
        payload.units_per_purchase_unit,
    )
    conversion_factor = packaging_conversion_factor(packaging_levels)
    if product is not None:
        product.packaging_purchase_unit = payload.purchase_unit.strip()
        product.packaging_levels = packaging_levels
    now = datetime.now(UTC)
    request = PurchaseRequest(
        id=str(uuid.uuid4()),
        product_id=product.id if product else None,
        item_name=product.name if product else payload.item_name,
        category=product.category if product else payload.category,
        active_ingredient=product.active_ingredient if product else payload.active_ingredient,
        presentation=product.presentation if product else payload.presentation,
        base_unit=product.unit if product else payload.base_unit,
        purchase_quantity=format_stock_quantity(parse_stock_quantity(payload.purchase_quantity)),
        purchase_unit=payload.purchase_unit,
        units_per_purchase_unit=format_stock_quantity(conversion_factor),
        packaging_levels=packaging_levels,
        received_quantity="0",
        supplier="",
        quoted_unit_price="",
        justification=payload.justification,
        status="requested",
        requested_by=principal.actor_name,
        approved_by="",
        received_by="",
        created_at=now,
        updated_at=now,
    )
    db.add(request)
    emit_audit_event(principal, "pharmacy", "purchase_request_created", request.id, db=db)
    db.commit()
    db.refresh(request)
    return serialize_purchase_request(request)


@app.patch("/api/v1/pharmacy/purchase-requests/{request_id}")
def update_purchase_request(
    request_id: str,
    payload: PurchaseRequestUpdatePayload,
    principal: Annotated[DemoPrincipal, Depends(require_demo_role("management"))],
    db: Annotated[Session, Depends(get_pharmacy_db)],
) -> dict[str, object]:
    request = db.get(PurchaseRequest, request_id)
    if request is None:
        raise HTTPException(status_code=404, detail="Solicitação de compra não encontrada")
    allowed_transitions = {
        "requested": {"quoted", "rejected"},
        "quoted": {"approved", "rejected"},
        "approved": {"ordered", "rejected"},
    }
    if payload.status not in allowed_transitions.get(request.status, set()):
        raise HTTPException(status_code=409, detail="Transição de compra inválida para a situação atual")
    if payload.status == "quoted":
        if not payload.supplier or not payload.quoted_unit_price:
            raise HTTPException(status_code=422, detail="Informe fornecedor e preço cotado antes de enviar para aprovação")
        request.supplier = payload.supplier
        request.quoted_unit_price = format_stock_quantity(
            parse_stock_quantity(payload.quoted_unit_price)
        )
    if payload.status == "approved":
        request.approved_by = principal.actor_name
    request.status = payload.status
    request.updated_at = datetime.now(UTC)
    emit_audit_event(principal, "pharmacy", "purchase_request_status_updated", request.id, db=db)
    db.commit()
    db.refresh(request)
    return serialize_purchase_request(request)


@app.post("/api/v1/pharmacy/purchase-requests/{request_id}/receipts", status_code=201)
def receive_purchase_request(
    request_id: str,
    payload: PurchaseReceiptPayload,
    principal: Annotated[DemoPrincipal, Depends(require_demo_role("pharmacy", "management"))],
    db: Annotated[Session, Depends(get_pharmacy_db)],
) -> dict[str, object]:
    request = db.get(PurchaseRequest, request_id)
    if request is None:
        raise HTTPException(status_code=404, detail="Solicitação de compra não encontrada")
    if request.status != "ordered":
        raise HTTPException(status_code=409, detail="Somente pedidos aprovados e enviados podem ser recebidos")
    received = parse_stock_quantity(payload.actual_purchase_quantity)
    received_so_far = parse_stock_quantity(request.received_quantity)
    requested = parse_stock_quantity(request.purchase_quantity)
    if received_so_far + received > requested:
        raise HTTPException(status_code=422, detail="A quantidade recebida excede o saldo do pedido")

    now = datetime.now(UTC)
    product = db.get(PharmacyProduct, request.product_id) if request.product_id else None
    if product is None:
        product = PharmacyProduct(
            name=request.item_name,
            category=request.category,
            active_ingredient=request.active_ingredient,
            presentation=request.presentation,
            unit=request.base_unit,
            metadata_source="manual",
            source_reference="",
            packaging_purchase_unit=request.purchase_unit,
            packaging_levels=request.packaging_levels,
            created_at=now,
        )
        db.add(product)
        db.flush()
        request.product_id = product.id
    product.packaging_levels = request.packaging_levels or normalized_packaging_levels(
        None,
        request.purchase_unit,
        request.base_unit,
        request.units_per_purchase_unit,
    )
    product.packaging_purchase_unit = request.purchase_unit

    location = None
    location_name = payload.storage_location
    if location_name:
        location = db.scalar(
            select(PharmacyLocation).where(PharmacyLocation.name == location_name)
        )
        if location is None:
            location = PharmacyLocation(name=location_name, created_at=now)
            db.add(location)
            db.flush()

    packaging_levels = request.packaging_levels or normalized_packaging_levels(
        None,
        request.purchase_unit,
        request.base_unit,
        request.units_per_purchase_unit,
    )
    factor = packaging_conversion_factor(packaging_levels)
    base_quantity = received * factor
    try:
        validate_base_stock_quantity(base_quantity)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    lot = InventoryLot(
        product_id=product.id,
        location_id=location.id if location else None,
        balance=format_stock_quantity(base_quantity),
        lot=payload.lot,
        expiry_date=payload.expiry_date,
        supplier=request.supplier,
        minimum_balance="0",
        average_balance="0",
        purchase_quantity=format_stock_quantity(received),
        purchase_unit=request.purchase_unit,
        units_per_purchase_unit=format_stock_quantity(factor),
        packaging_levels=packaging_levels,
        created_at=now,
    )
    db.add(lot)
    db.flush()
    db.add(
        PharmacyStockMovement(
            item_id=lot.id,
            movement_type="entry",
            quantity=format_stock_quantity(base_quantity),
            balance_after=lot.balance,
            reason=(
                f"Recebimento da solicitação {request.id}: "
                f"{describe_packaging_conversion(format_stock_quantity(received), request.purchase_unit, packaging_levels, lot.balance, product.unit)}."
            ),
            actor_id=principal.user_id,
            actor_name=principal.actor_name,
            created_at=now,
        )
    )
    request.received_quantity = format_stock_quantity(received_so_far + received)
    request.status = "received" if received_so_far + received == requested else "ordered"
    request.received_by = principal.actor_name
    request.updated_at = now
    emit_audit_event(principal, "pharmacy", "purchase_request_received", request.id, db=db)
    db.commit()
    db.refresh(lot)
    db.refresh(request)
    return {
        "request": serialize_purchase_request(request),
        "lot": serialize_item(lot),
    }


@app.get("/api/v1/pharmacy/movements")
def list_stock_movements(
    principal: Annotated[DemoPrincipal, Depends(PHARMACY_ROLE)],
    db: Annotated[Session, Depends(get_pharmacy_db)],
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
    offset: Annotated[int, Query(ge=0)] = 0,
    item_id: Annotated[int | None, Query(ge=1)] = None,
    movement_type: Literal["opening_balance", "entry", "issue", "adjustment"] | None = None,
    from_date: date | None = None,
    to_date: date | None = None,
) -> dict[str, object]:
    if from_date and to_date and from_date > to_date:
        raise HTTPException(
            status_code=422,
            detail="A data inicial não pode ser posterior à data final",
        )

    filters = [PharmacyStockMovement.reason != DISPENSATION_MOVEMENT_REASON]
    if item_id is not None:
        filters.append(PharmacyStockMovement.item_id == item_id)
    if movement_type is not None:
        filters.append(PharmacyStockMovement.movement_type == movement_type)
    local_timezone = ZoneInfo("America/Sao_Paulo")
    if from_date is not None:
        starts_at = datetime.combine(
            from_date, time.min, tzinfo=local_timezone
        ).astimezone(UTC)
        filters.append(PharmacyStockMovement.created_at >= starts_at)
    if to_date is not None:
        ends_at = datetime.combine(
            to_date + timedelta(days=1), time.min, tzinfo=local_timezone
        ).astimezone(UTC)
        filters.append(PharmacyStockMovement.created_at < ends_at)

    query = select(PharmacyStockMovement).where(*filters)
    count_query = select(func.count(PharmacyStockMovement.id)).where(*filters)
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
        select(InventoryLot).where(InventoryLot.id == item_id).with_for_update()
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
    previous_balance = item.balance
    updated_balance = format_stock_quantity(new_balance)
    changed = db.execute(
        update(InventoryLot)
        .where(InventoryLot.id == item.id, InventoryLot.balance == previous_balance)
        .values(balance=updated_balance)
        .execution_options(synchronize_session=False)
    )
    if changed.rowcount != 1:
        raise HTTPException(status_code=409, detail="O saldo do lote foi alterado em outra operação. Atualize e tente novamente")
    movement = PharmacyStockMovement(
        item_id=item.id,
        movement_type=payload.movement_type,
        quantity=format_stock_quantity(delta),
        balance_after=updated_balance,
        reason=payload.reason.strip(),
        actor_id=principal.user_id,
        actor_name=principal.actor_name,
        created_at=now,
    )
    db.add(movement)
    emit_audit_event(
        principal, "pharmacy", "stock_movement_created", str(item.id), db=db
    )
    db.commit()
    db.refresh(movement)
    db.refresh(item)
    return serialize_stock_movement(movement)


@app.get("/api/v1/pharmacy/dispensations")
def list_dispensations(
    principal: Annotated[DemoPrincipal, Depends(DISPENSATION_READ_ROLE)],
    db: Annotated[Session, Depends(get_pharmacy_db)],
    patient_reference: str | None = None,
    status: Literal["dispensed", "cancelled"] | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 500,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> dict[str, object]:
    query = select(MedicationDispense)
    if patient_reference:
        patient = verify_patient_reference(patient_reference)
        query = query.where(MedicationDispense.patient_reference.in_(patient["references"]))
    if status:
        query = query.where(MedicationDispense.status == status)
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    records = db.scalars(
        query.order_by(MedicationDispense.created_at.desc()).offset(offset).limit(limit)
    ).all()
    emit_audit_event(principal, "pharmacy", "medication_dispensations_read", "medication_dispensations")
    return {"dispensations": [serialize_dispensation(record) for record in records], "total": total, "limit": limit, "offset": offset}


def resolve_internal_prescription(
    prescription_reference: str,
    patient_reference: str,
    *,
    fulfill: bool,
) -> None:
    nursing_url = os.getenv("SCPO_NURSING_API_URL", "http://nursing:8000").rstrip("/")
    service_token = os.getenv("SCPO_SERVICE_TOKEN", "")
    if not service_token:
        raise HTTPException(status_code=503, detail="Validação da prescrição indisponível")
    try:
        response = httpx.post(
            f"{nursing_url}/internal/v1/physicians/prescriptions/resolve",
            headers={"X-Service-Token": service_token},
            json={
                "prescription_reference": prescription_reference,
                "patient_reference": patient_reference,
                "fulfill": fulfill,
            },
            timeout=3.0,
        )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=503, detail="Serviço de prescrições indisponível") from exc
    if response.is_success:
        return
    try:
        detail = response.json().get("detail")
    except (ValueError, AttributeError):
        detail = None
    raise HTTPException(
        status_code=response.status_code if 400 <= response.status_code < 500 else 503,
        detail=detail if isinstance(detail, str) else "Não foi possível validar a prescrição",
    )


@app.post("/api/v1/pharmacy/dispensations", status_code=201)
def create_dispensation(
    payload: MedicationDispensePayload,
    principal: Annotated[DemoPrincipal, Depends(PHARMACY_ROLE)],
    db: Annotated[Session, Depends(get_pharmacy_db)],
) -> dict[str, object]:
    patient = verify_patient_reference(payload.patient_reference)
    prescription_reference = payload.prescription_reference.strip()
    existing_dispensation = db.scalar(
        select(MedicationDispense).where(
            MedicationDispense.prescription_reference == prescription_reference
        )
    )
    if existing_dispensation is not None:
        if existing_dispensation.patient_reference != patient["reference"]:
            raise HTTPException(
                status_code=409,
                detail="Esta prescrição já está vinculada a outro paciente",
            )
        resolve_internal_prescription(
            prescription_reference, patient["reference"], fulfill=True
        )
        response = serialize_dispensation(existing_dispensation)
        response["prescription_fulfillment_pending"] = False
        return response
    resolve_internal_prescription(
        prescription_reference, patient["reference"], fulfill=False
    )
    if not payload.allergy_reviewed:
        raise HTTPException(status_code=422, detail="Confirme a revisão das alergias do paciente antes de dispensar")
    item = db.scalar(
        select(InventoryLot).where(InventoryLot.id == payload.item_id).with_for_update()
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Lote não encontrado")
    if item.product.category.casefold() != "medicamento":
        raise HTTPException(status_code=422, detail="Somente itens da categoria medicamento podem ser dispensados")
    if item.expiry_date < date.today():
        raise HTTPException(status_code=409, detail="Lote vencido não pode ser dispensado")
    amount = parse_stock_quantity(payload.quantity)
    if amount <= 0:
        raise HTTPException(status_code=422, detail="Informe uma quantidade maior que zero")
    balance = parse_stock_quantity(item.balance)
    if amount > balance:
        raise HTTPException(status_code=409, detail="Saldo insuficiente para a dispensação")

    now = datetime.now(UTC)
    previous_balance = item.balance
    updated_balance = format_stock_quantity(balance - amount)
    changed = db.execute(
        update(InventoryLot)
        .where(InventoryLot.id == item.id, InventoryLot.balance == previous_balance)
        .values(balance=updated_balance)
        .execution_options(synchronize_session=False)
    )
    if changed.rowcount != 1:
        raise HTTPException(status_code=409, detail="O saldo do lote foi alterado em outra operação. Atualize e tente novamente")
    dispense = MedicationDispense(
        id=str(uuid.uuid4()),
        patient_reference=patient["reference"],
        item_id=item.id,
        medication_name=item.product.name,
        quantity=format_stock_quantity(amount),
        unit=item.product.unit,
        instructions=payload.instructions,
        prescription_reference=prescription_reference,
        prescriber_name=payload.prescriber_name.strip(),
        allergy_reviewed=payload.allergy_reviewed,
        status="dispensed",
        actor_id=principal.user_id,
        actor_name=principal.actor_name,
        created_at=now,
    )
    db.add(dispense)
    db.add(
        PharmacyStockMovement(
            item_id=item.id,
            movement_type="issue",
            quantity=format_stock_quantity(-amount),
            balance_after=updated_balance,
            reason=DISPENSATION_MOVEMENT_REASON,
            actor_id=principal.user_id,
            actor_name=principal.actor_name,
            created_at=now,
        )
    )
    emit_audit_event(principal, "pharmacy", "medication_dispensed", dispense.id, db=db)
    db.commit()
    response = serialize_dispensation(dispense)
    try:
        resolve_internal_prescription(
            prescription_reference, patient["reference"], fulfill=True
        )
        response["prescription_fulfillment_pending"] = False
    except HTTPException:
        response["prescription_fulfillment_pending"] = True
    return response


@app.post("/internal/v1/pharmacy/dispensations/resolve")
def resolve_dispensation(
    payload: dict[str, str],
    db: Annotated[Session, Depends(get_pharmacy_db)],
    _: Annotated[None, Depends(require_service_token)],
) -> dict[str, str]:
    dispensation = db.get(MedicationDispense, payload.get("id", ""))
    if dispensation is None or dispensation.status != "dispensed":
        raise HTTPException(status_code=404, detail="Dispensação não encontrada ou indisponível")
    return {
        "id": dispensation.id,
        "patient_reference": dispensation.patient_reference,
        "medication_name": dispensation.medication_name,
        "quantity": dispensation.quantity,
        "unit": dispensation.unit,
    }


@app.patch("/api/v1/pharmacy/items/{item_id}/stock-thresholds")
def update_stock_thresholds(
    item_id: int,
    payload: StockThresholdPayload,
    principal: Annotated[DemoPrincipal, Depends(PHARMACY_ROLE)],
    db: Annotated[Session, Depends(get_pharmacy_db)],
) -> dict[str, object]:
    item = db.get(InventoryLot, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Item de estoque não encontrado")
    return update_product_stock_thresholds(
        item.product_id,
        payload,
        principal,
        db,
    )


@app.patch("/api/v1/pharmacy/products/{product_id}/stock-thresholds")
def update_product_stock_thresholds(
    product_id: int,
    payload: StockThresholdPayload,
    principal: Annotated[DemoPrincipal, Depends(PHARMACY_ROLE)],
    db: Annotated[Session, Depends(get_pharmacy_db)],
) -> dict[str, object]:
    product = db.get(PharmacyProduct, product_id)
    if product is None:
        raise HTTPException(status_code=404, detail="Produto de estoque não encontrado")
    product.minimum_balance = payload.minimum_balance
    product.average_balance = payload.average_balance
    emit_audit_event(
        principal,
        "pharmacy",
        "inventory_product_thresholds_updated",
        str(product.id),
        db=db,
    )
    db.commit()
    db.refresh(product)
    item = db.scalar(
        select(InventoryLot)
        .where(InventoryLot.product_id == product.id)
        .order_by(InventoryLot.expiry_date, InventoryLot.id)
        .limit(1)
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Produto sem lotes cadastrados")
    return serialize_item(item)


def serialize_item(item: InventoryLot) -> dict[str, object]:
    packaging_levels = item.packaging_levels or normalized_packaging_levels(
        None,
        item.purchase_unit or item.product.unit,
        item.product.unit,
        item.units_per_purchase_unit,
    )
    return {
        "id": item.id,
        "product_id": item.product_id,
        "item_name": item.product.name,
        "balance": item.balance,
        "unit": item.product.unit,
        "purchase_quantity": item.purchase_quantity,
        "purchase_unit": item.purchase_unit or item.product.unit,
        "units_per_purchase_unit": item.units_per_purchase_unit,
        "packaging_levels": packaging_levels,
        "product_packaging_levels": item.product.packaging_levels or packaging_levels,
        "product_packaging_unit": item.product.packaging_purchase_unit,
        "lot": item.lot,
        "expiry_date": item.expiry_date.isoformat(),
        "created_at": item.created_at.isoformat(),
        "barcode": item.product.gtin or item.product.legacy_identifier,
        "category": item.product.category,
        "active_ingredient": item.product.active_ingredient,
        "presentation": item.product.presentation,
        "metadata_source": item.product.metadata_source,
        "source_reference": item.product.source_reference,
        "supplier": item.supplier,
        "storage_location": item.location.name if item.location else "",
        "minimum_balance": item.product.minimum_balance,
        "average_balance": item.product.average_balance,
    }


def serialize_purchase_request(request: PurchaseRequest) -> dict[str, object]:
    packaging_levels = request.packaging_levels or normalized_packaging_levels(
        None,
        request.purchase_unit,
        request.base_unit,
        request.units_per_purchase_unit,
    )
    return {
        "id": request.id,
        "product_id": request.product_id,
        "item_name": request.item_name,
        "category": request.category,
        "active_ingredient": request.active_ingredient,
        "presentation": request.presentation,
        "base_unit": request.base_unit,
        "purchase_quantity": request.purchase_quantity,
        "purchase_unit": request.purchase_unit,
        "units_per_purchase_unit": request.units_per_purchase_unit,
        "packaging_levels": packaging_levels,
        "received_quantity": request.received_quantity,
        "supplier": request.supplier,
        "quoted_unit_price": request.quoted_unit_price,
        "justification": request.justification,
        "status": request.status,
        "requested_by": request.requested_by,
        "approved_by": request.approved_by,
        "received_by": request.received_by,
        "created_at": request.created_at.isoformat(),
        "updated_at": request.updated_at.isoformat(),
    }


def serialize_catalog_entry(entry: AnvisaCatalogEntry) -> dict[str, str]:
    return {
        "gtin": entry.gtin,
        "product_name": entry.product_name,
        "active_ingredient": entry.active_ingredient,
        "presentation": entry.presentation,
        "manufacturer": entry.manufacturer,
        "registration": entry.registration,
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


def serialize_dispensation(dispensation: MedicationDispense) -> dict[str, object]:
    return {
        "id": dispensation.id,
        "patient_reference": dispensation.patient_reference,
        "item_id": dispensation.item_id,
        "medication_name": dispensation.medication_name,
        "quantity": dispensation.quantity,
        "unit": dispensation.unit,
        "instructions": dispensation.instructions,
        "prescription_reference": dispensation.prescription_reference,
        "prescriber_name": dispensation.prescriber_name,
        "allergy_reviewed": dispensation.allergy_reviewed,
        "status": dispensation.status,
        "actor_name": dispensation.actor_name,
        "created_at": dispensation.created_at.isoformat(),
    }
