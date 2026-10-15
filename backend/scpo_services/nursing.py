import re
import uuid
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime, time, timedelta
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import JSON, Boolean, Date, DateTime, Integer, String, Text, func, select
from sqlalchemy.orm import Mapped, Session, mapped_column

from .common import (
    Base,
    DemoPrincipal,
    database_session,
    get_engine,
    require_demo_role,
    verify_database_migrated,
)


class VitalRecord(Base):
    __tablename__ = "vital_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    patient_reference: Mapped[str] = mapped_column(String(36), nullable=False)
    actor_id: Mapped[str] = mapped_column(String(36), nullable=False)
    actor_name: Mapped[str] = mapped_column(String(120), nullable=False)
    values: Mapped[dict[str, str]] = mapped_column(JSON, nullable=False)
    glucose_unit: Mapped[str] = mapped_column(String(12), nullable=False)
    not_applicable: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )


class Patient(Base):
    __tablename__ = "patients"

    reference: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    room: Mapped[str] = mapped_column(String(20), nullable=False)
    bed: Mapped[str] = mapped_column(String(20), nullable=False)
    birth_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    sex: Mapped[str] = mapped_column(String(24), nullable=False, default="")
    phone: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    email: Mapped[str] = mapped_column(String(160), nullable=False, default="")
    address: Mapped[str] = mapped_column(String(180), nullable=False, default="")
    address_number: Mapped[str] = mapped_column(String(24), nullable=False, default="")
    address_complement: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    neighborhood: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    city: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    state: Mapped[str] = mapped_column(String(2), nullable=False, default="")
    postal_code: Mapped[str] = mapped_column(String(12), nullable=False, default="")
    responsible_name: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    responsible_relationship: Mapped[str] = mapped_column(String(60), nullable=False, default="")
    responsible_phone: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    responsible_address: Mapped[str] = mapped_column(String(180), nullable=False, default="")
    responsible_address_number: Mapped[str] = mapped_column(String(24), nullable=False, default="")
    responsible_address_complement: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    responsible_neighborhood: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    responsible_city: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    responsible_state: Mapped[str] = mapped_column(String(2), nullable=False, default="")
    responsible_postal_code: Mapped[str] = mapped_column(String(12), nullable=False, default="")
    photo_data: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_by: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


def get_nursing_db():
    yield from database_session("nursing")


@asynccontextmanager
async def lifespan(_: FastAPI):
    verify_database_migrated("nursing")
    yield


app = FastAPI(
    title="SCPO Connect · Serviço de Enfermagem",
    version="1.0.0",
    description="API para cadastro de pacientes e registros de sinais vitais.",
    lifespan=lifespan,
)

NURSING_ROLE = require_demo_role("nursing")
VALUE_FIELDS = {
    "saturation",
    "pressure",
    "heartRate",
    "respiratoryRate",
    "glucose",
    "venousSite",
    "venousCondition",
    "venousNote",
    "urine",
    "bowel",
    "pain",
    "painScale",
    "notes",
}
NUMERIC_FIELDS = {"saturation", "heartRate", "respiratoryRate", "glucose", "pain"}
VITAL_FIELDS = {"saturation", "pressure", "heartRate", "respiratoryRate", "glucose"}


class PatientPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=2, max_length=120)
    room: str = Field(min_length=1, max_length=20)
    bed: str = Field(min_length=1, max_length=20)
    birth_date: date | None = None
    sex: str = Field(default="", max_length=24)
    phone: str = Field(default="", max_length=40)
    email: str = Field(default="", max_length=160)
    address: str = Field(default="", max_length=180)
    address_number: str = Field(default="", max_length=24)
    address_complement: str = Field(default="", max_length=100)
    neighborhood: str = Field(default="", max_length=100)
    city: str = Field(default="", max_length=100)
    state: str = Field(default="", max_length=2)
    postal_code: str = Field(default="", max_length=12)
    responsible_name: str = Field(default="", max_length=120)
    responsible_relationship: str = Field(default="", max_length=60)
    responsible_phone: str = Field(default="", max_length=40)
    responsible_address: str = Field(default="", max_length=180)
    responsible_address_number: str = Field(default="", max_length=24)
    responsible_address_complement: str = Field(default="", max_length=100)
    responsible_neighborhood: str = Field(default="", max_length=100)
    responsible_city: str = Field(default="", max_length=100)
    responsible_state: str = Field(default="", max_length=2)
    responsible_postal_code: str = Field(default="", max_length=12)
    photo_data: str = Field(default="", max_length=1_500_000)

    @field_validator("photo_data")
    @classmethod
    def validate_photo(cls, value: str) -> str:
        if value and not re.fullmatch(r"data:image/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}", value):
            raise ValueError("A foto deve ser uma imagem JPEG, PNG ou WebP válida")
        return value


PATIENT_MODULES = ("patients", "nursing", "reception", "therapy", "nutrition", "social", "hygiene", "xray", "psychology", "management")


async def authorize_patient_module(request: Request) -> DemoPrincipal:
    from .common import authenticated_principal

    principal = await authenticated_principal(request)
    action = {"GET": "consultar", "HEAD": "consultar", "POST": "criar", "PUT": "alterar", "PATCH": "alterar"}.get(request.method.upper(), "consultar")
    if any(module in principal.modules and action in principal.permissions.get(module, []) for module in PATIENT_MODULES):
        return principal
    raise HTTPException(status_code=403, detail="Acesso ao cadastro de pacientes não autorizado")


PATIENT_ACCESS = Depends(authorize_patient_module)
PATIENT_HISTORY_ACCESS = Depends(require_demo_role("patients", "nursing", "management"))


class VitalPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    patient_reference: str = Field(min_length=1, max_length=36)
    values: dict[str, str] = Field(default_factory=dict)
    glucose_unit: Literal["mg/dL", "mmol/L"] = "mg/dL"
    not_applicable: list[str] = Field(default_factory=list)

    @field_validator("values")
    @classmethod
    def validate_values(cls, values: dict[str, str]) -> dict[str, str]:
        unexpected = values.keys() - VALUE_FIELDS
        if unexpected:
            raise ValueError("Campo não permitido")
        for field, value in values.items():
            if len(value) > 1000:
                raise ValueError("Campo excede o limite permitido")
            if (
                field in NUMERIC_FIELDS
                and value
                and not re.fullmatch(r"\d{1,6}(?:[.,]\d{1,4})?", value)
            ):
                raise ValueError("Informe um valor numérico válido")
            if (
                field == "pressure"
                and value
                and not re.fullmatch(r"\d{1,4}/\d{1,4}", value)
            ):
                raise ValueError("Formato inválido para pressão arterial")
        if len(values.get("notes", "")) > 1000:
            raise ValueError("Observações excedem o limite permitido")
        return values

    @field_validator("not_applicable")
    @classmethod
    def validate_not_applicable(cls, fields: list[str]) -> list[str]:
        if len(fields) != len(set(fields)) or any(
            field not in VITAL_FIELDS for field in fields
        ):
            raise ValueError("Campo não permitido em não aplicável")
        return fields


@app.get("/health")
def health() -> dict[str, str]:
    return {"service": "nursing", "status": "ok"}


@app.post("/api/v1/nursing/vitals", status_code=201)
def create_vital_record(
    payload: VitalPayload,
    principal: Annotated[DemoPrincipal, Depends(NURSING_ROLE)],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, object]:
    if db.get(Patient, payload.patient_reference) is None:
        raise HTTPException(status_code=404, detail="Paciente não encontrado")
    record = VitalRecord(
        patient_reference=payload.patient_reference,
        actor_id=principal.user_id,
        actor_name=principal.actor_name,
        values=payload.values,
        glucose_unit=payload.glucose_unit,
        not_applicable=payload.not_applicable,
        recorded_at=datetime.now(UTC),
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return serialize_record(record)


@app.get("/api/v1/nursing/patients")
def list_patients(
    principal: Annotated[DemoPrincipal, PATIENT_ACCESS],
    db: Annotated[Session, Depends(get_nursing_db)],
    full_profile: bool = False,
) -> dict[str, list[dict[str, object]]]:
    if full_profile and not can_view_full_patient_profile(principal):
        raise HTTPException(status_code=403, detail="Acesso aos dados cadastrais completos não autorizado")
    patients = db.scalars(select(Patient).where(Patient.active.is_(True)).order_by(Patient.room, Patient.bed)).all()
    return {"patients": [serialize_patient(patient, full_profile=full_profile) for patient in patients]}


@app.post("/api/v1/nursing/patients", status_code=201)
def create_patient(
    payload: PatientPayload,
    principal: Annotated[DemoPrincipal, PATIENT_ACCESS],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, object]:
    patient = Patient(reference=str(uuid.uuid4()), **payload.model_dump(), created_at=datetime.now(UTC), updated_at=datetime.now(UTC), updated_by=principal.actor_name)
    db.add(patient)
    db.commit()
    db.refresh(patient)
    return serialize_patient(patient, full_profile=can_view_full_patient_profile(principal))


@app.put("/api/v1/nursing/patients/{patient_reference}")
def update_patient(
    patient_reference: str,
    payload: PatientPayload,
    principal: Annotated[DemoPrincipal, PATIENT_ACCESS],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, object]:
    patient = db.get(Patient, patient_reference)
    if patient is None:
        raise HTTPException(status_code=404, detail="Paciente não encontrado")
    for key, value in payload.model_dump().items():
        setattr(patient, key, value)
    patient.updated_at = datetime.now(UTC)
    patient.updated_by = principal.actor_name
    db.commit()
    db.refresh(patient)
    return serialize_patient(patient, full_profile=can_view_full_patient_profile(principal))


@app.get("/api/v1/nursing/patients/{patient_reference}/history")
def list_patient_history(
    patient_reference: str,
    _: Annotated[DemoPrincipal, PATIENT_HISTORY_ACCESS],
    db: Annotated[Session, Depends(get_nursing_db)],
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> dict[str, object]:
    if db.get(Patient, patient_reference) is None:
        raise HTTPException(status_code=404, detail="Paciente não encontrado")
    query = select(VitalRecord).where(VitalRecord.patient_reference == patient_reference).order_by(VitalRecord.recorded_at.desc())
    total = db.scalar(select(func.count(VitalRecord.id)).where(VitalRecord.patient_reference == patient_reference)) or 0
    records = db.scalars(query.offset(offset).limit(limit)).all()
    return {"records": [serialize_record(record) for record in records], "total": total, "limit": limit, "offset": offset}


def can_view_full_patient_profile(principal: DemoPrincipal) -> bool:
    return any(module in principal.modules and "consultar" in principal.permissions.get(module, []) for module in ("patients", "reception", "management"))


def serialize_patient(patient: Patient, *, full_profile: bool = False) -> dict[str, object]:
    result: dict[str, object] = {
        "reference": patient.reference,
        "name": patient.name,
        "room": patient.room,
        "bed": patient.bed,
        "birth_date": patient.birth_date,
    }
    if full_profile:
        result.update({key: getattr(patient, key) for key in PatientPayload.model_fields})
        result.update({"created_at": patient.created_at.isoformat() if patient.created_at else None, "updated_at": patient.updated_at.isoformat() if patient.updated_at else None, "updated_by": patient.updated_by})
    return result


@app.get("/api/v1/nursing/vitals")
def list_vital_records(
    principal: Annotated[DemoPrincipal, Depends(NURSING_ROLE)],
    db: Annotated[Session, Depends(get_nursing_db)],
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
    offset: Annotated[int, Query(ge=0)] = 0,
    patient_reference: str | None = None,
    room: str | None = None,
    bed: str | None = None,
    from_date: date | None = None,
    to_date: date | None = None,
) -> dict[str, object]:
    if from_date and to_date and from_date > to_date:
        raise HTTPException(status_code=422, detail="A data inicial deve ser anterior ou igual à data final")

    filters = []
    if patient_reference:
        filters.append(VitalRecord.patient_reference == patient_reference)
    if room:
        filters.append(Patient.room == room)
    if bed:
        filters.append(Patient.bed == bed)
    if from_date:
        filters.append(VitalRecord.recorded_at >= datetime.combine(from_date, time.min, UTC))
    if to_date:
        filters.append(VitalRecord.recorded_at < datetime.combine(to_date + timedelta(days=1), time.min, UTC))

    records_query = select(VitalRecord)
    count_query = select(func.count(VitalRecord.id))
    if room or bed:
        records_query = records_query.join(Patient, Patient.reference == VitalRecord.patient_reference)
        count_query = count_query.join(Patient, Patient.reference == VitalRecord.patient_reference)
    records = db.scalars(
        records_query.where(*filters).order_by(VitalRecord.recorded_at.desc()).offset(offset).limit(limit)
    ).all()
    total = db.scalar(count_query.where(*filters)) or 0
    return {"records": [serialize_record(record) for record in records], "total": total, "limit": limit, "offset": offset}


def serialize_record(record: VitalRecord) -> dict[str, object]:
    return {
        "id": record.id,
        "patient_reference": record.patient_reference,
        "actor_id": record.actor_id,
        "actor_name": record.actor_name,
        "values": record.values,
        "glucose_unit": record.glucose_unit,
        "not_applicable": record.not_applicable,
        "recorded_at": record.recorded_at.isoformat(),
    }
