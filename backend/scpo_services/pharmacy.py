import calendar
import csv
import hashlib
import io
import re
import uuid
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime
from decimal import Decimal, InvalidOperation
from email.utils import parsedate_to_datetime
from typing import Annotated, Literal

import httpx
from fastapi import Depends, FastAPI, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import (
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

from .common import (
    Base,
    DemoPrincipal,
    audit_outbox_lifespan,
    database_session,
    emit_audit_event,
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
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    product: Mapped[PharmacyProduct] = relationship()
    location: Mapped[PharmacyLocation | None] = relationship()


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
        yield


app = FastAPI(
    title="SCPO Connect · Serviço de Farmácia", version="1.0.0", lifespan=lifespan
)
PHARMACY_ROLE = require_demo_role("pharmacy")
INVENTORY_READ_ROLE = require_demo_role("pharmacy", "management")
DISPENSATION_READ_ROLE = require_demo_role("pharmacy", "nursing", "management")
ANVISA_CMED_CATALOG_URL = "https://dados.anvisa.gov.br/dados/TA_PRECO_MEDICAMENTO.csv"
MAX_ANVISA_CATALOG_BYTES = 32 * 1024 * 1024


class InventoryPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    item_name: str = Field(min_length=1, max_length=120)
    balance: str = Field(pattern=r"^\d{1,9}(?:[.,]\d{1,3})?$", max_length=32)
    unit: str = Field(min_length=1, max_length=24)
    lot: str = Field(min_length=1, max_length=80)
    expiry_date: date
    barcode: str = Field(default="", max_length=200)
    category: str = Field(default="Medicamento", min_length=2, max_length=40)
    active_ingredient: str = Field(default="", max_length=120)
    presentation: str = Field(default="", max_length=120)
    catalog_registration: str = Field(default="", max_length=32)
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
    reader = csv.DictReader(io.StringIO(csv_text), delimiter=";")
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
    principal: Annotated[DemoPrincipal, Depends(INVENTORY_READ_ROLE)],
    db: Annotated[Session, Depends(get_pharmacy_db)],
) -> dict[str, list[dict[str, object]]]:
    today = date.today()
    alerts: list[dict[str, object]] = []
    for item in db.scalars(
        select(InventoryLot)
        .options(joinedload(InventoryLot.product), joinedload(InventoryLot.location))
        .order_by(InventoryLot.expiry_date, InventoryLot.id)
    ).all():
        balance = parse_stock_quantity(item.balance)
        minimum = parse_stock_quantity(item.minimum_balance)
        average = parse_stock_quantity(item.average_balance)
        days_to_expiry = (item.expiry_date - today).days
        kinds: list[str] = []
        if balance <= minimum:
            kinds.append("critical_stock" if balance <= 0 else "below_minimum")
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
                "unit": item.product.unit,
                "minimum_balance": item.minimum_balance,
                "suggested_replenishment": format_stock_quantity(max(average - balance, Decimal(0))),
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
    emit_audit_event(principal, "pharmacy", "anvisa_catalog_status_read", "anvisa_catalog_entries")
    return {
        "source": "Anvisa/CMED · lista pública de preços de medicamentos",
        "source_url": ANVISA_CMED_CATALOG_URL,
        "entry_count": count,
        "imported_at": imported_at.isoformat() if imported_at else None,
        "source_updated_at": source_updated_at.isoformat() if source_updated_at else None,
    }


@app.post("/api/v1/pharmacy/catalog/anvisa/refresh")
def refresh_anvisa_catalog(
    principal: Annotated[DemoPrincipal, Depends(PHARMACY_ROLE)],
    db: Annotated[Session, Depends(get_pharmacy_db)],
) -> dict[str, object]:
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
                raise HTTPException(status_code=502, detail="O arquivo Anvisa excede o limite de importação configurado")
            chunks: list[bytes] = []
            total_bytes = 0
            for chunk in response.iter_bytes():
                total_bytes += len(chunk)
                if total_bytes > MAX_ANVISA_CATALOG_BYTES:
                    raise HTTPException(status_code=502, detail="O arquivo Anvisa excede o limite de importação configurado")
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

    db.execute(delete(AnvisaCatalogEntry))
    for start in range(0, len(records), 1000):
        db.execute(insert(AnvisaCatalogEntry), records[start:start + 1000])
    emit_audit_event(
        principal,
        "pharmacy",
        "anvisa_catalog_refreshed",
        str(len(records)),
        db=db,
    )
    db.commit()
    return {
        "source": "Anvisa/CMED · lista pública de preços de medicamentos",
        "source_url": ANVISA_CMED_CATALOG_URL,
        "entry_count": len(records),
        "imported_at": imported_at.isoformat(),
        "source_updated_at": source_updated_at.isoformat() if source_updated_at else None,
    }


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

    if product is None:
        product = PharmacyProduct(
            gtin=gtin,
            legacy_identifier=payload.barcode[:40] if not gtin else "",
            name=payload.item_name.strip(),
            category=payload.category.strip(),
            active_ingredient=payload.active_ingredient.strip(),
            presentation=payload.presentation.strip(),
            unit=payload.unit.strip(),
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
        balance=payload.balance,
        lot=payload.lot.strip(),
        expiry_date=payload.expiry_date,
        supplier=payload.supplier.strip(),
        minimum_balance=payload.minimum_balance,
        average_balance=payload.average_balance,
        created_at=now,
    )
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
    emit_audit_event(
        principal, "pharmacy", "inventory_item_created", str(item.id), db=db
    )
    db.commit()
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
) -> dict[str, list[dict[str, object]]]:
    query = select(MedicationDispense)
    if patient_reference:
        query = query.where(MedicationDispense.patient_reference == patient_reference)
    if status:
        query = query.where(MedicationDispense.status == status)
    records = db.scalars(
        query.order_by(MedicationDispense.created_at.desc()).limit(500)
    ).all()
    emit_audit_event(principal, "pharmacy", "medication_dispensations_read", "medication_dispensations")
    return {"dispensations": [serialize_dispensation(record) for record in records]}


@app.post("/api/v1/pharmacy/dispensations", status_code=201)
def create_dispensation(
    payload: MedicationDispensePayload,
    principal: Annotated[DemoPrincipal, Depends(PHARMACY_ROLE)],
    db: Annotated[Session, Depends(get_pharmacy_db)],
) -> dict[str, object]:
    patient = verify_patient_reference(payload.patient_reference)
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
        prescription_reference=payload.prescription_reference.strip(),
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
            reason="Dispensação vinculada ao paciente.",
            actor_id=principal.user_id,
            actor_name=principal.actor_name,
            created_at=now,
        )
    )
    emit_audit_event(principal, "pharmacy", "medication_dispensed", dispense.id, db=db)
    db.commit()
    return serialize_dispensation(dispense)


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
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="Item de estoque não encontrado")
    item.minimum_balance = payload.minimum_balance
    item.average_balance = payload.average_balance
    emit_audit_event(
        principal, "pharmacy", "inventory_thresholds_updated", str(item.id), db=db
    )
    db.commit()
    db.refresh(item)
    return serialize_item(item)


def serialize_item(item: InventoryLot) -> dict[str, object]:
    return {
        "id": item.id,
        "product_id": item.product_id,
        "item_name": item.product.name,
        "balance": item.balance,
        "unit": item.product.unit,
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
        "minimum_balance": item.minimum_balance,
        "average_balance": item.average_balance,
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
