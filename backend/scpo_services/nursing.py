import re
import uuid
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import JSON, Boolean, DateTime, Integer, String, select
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
    _: Annotated[DemoPrincipal, Depends(NURSING_ROLE)],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, list[dict[str, object]]]:
    patients = db.scalars(select(Patient).where(Patient.active.is_(True)).order_by(Patient.room, Patient.bed)).all()
    return {"patients": [serialize_patient(patient) for patient in patients]}


@app.post("/api/v1/nursing/patients", status_code=201)
def create_patient(
    payload: PatientPayload,
    _: Annotated[DemoPrincipal, Depends(NURSING_ROLE)],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, object]:
    patient = Patient(reference=str(uuid.uuid4()), **payload.model_dump())
    db.add(patient)
    db.commit()
    return serialize_patient(patient)


def serialize_patient(patient: Patient) -> dict[str, object]:
    return {"reference": patient.reference, "name": patient.name, "room": patient.room, "bed": patient.bed}


@app.get("/api/v1/nursing/vitals")
def list_vital_records(
    principal: Annotated[DemoPrincipal, Depends(NURSING_ROLE)],
    db: Annotated[Session, Depends(get_nursing_db)],
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
    patient_reference: str | None = None,
) -> dict[str, list[dict[str, object]]]:
    query = select(VitalRecord).order_by(VitalRecord.recorded_at.desc())
    if patient_reference:
        query = query.where(VitalRecord.patient_reference == patient_reference)
    records = db.scalars(query.limit(limit)).all()
    return {"records": [serialize_record(record) for record in records]}


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
