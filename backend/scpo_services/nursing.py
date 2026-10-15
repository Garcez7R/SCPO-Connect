import re
import uuid
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime, time, timedelta
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import JSON, Boolean, Date, DateTime, ForeignKey, Integer, String, Text, func, select
from sqlalchemy.orm import Mapped, Session, mapped_column

from .common import (
    Base,
    DemoPrincipal,
    database_session,
    get_engine,
    require_demo_role,
    require_service_token,
    emit_audit_event,
    verify_database_migrated,
)


class VitalRecord(Base):
    __tablename__ = "vital_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    patient_reference: Mapped[str] = mapped_column(String(36), ForeignKey("patients.reference", ondelete="RESTRICT"), nullable=False)
    actor_id: Mapped[str] = mapped_column(String(36), nullable=False)
    actor_name: Mapped[str] = mapped_column(String(120), nullable=False)
    values: Mapped[dict[str, str]] = mapped_column(JSON, nullable=False)
    glucose_unit: Mapped[str] = mapped_column(String(12), nullable=False)
    not_applicable: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    voided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    voided_by: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    void_reason: Mapped[str] = mapped_column(String(500), nullable=False, default="")


class PatientObservation(Base):
    __tablename__ = "patient_observations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    patient_reference: Mapped[str] = mapped_column(String(36), ForeignKey("patients.reference", ondelete="RESTRICT"), nullable=False)
    attention_level: Mapped[str] = mapped_column(String(12), nullable=False)
    observation: Mapped[str] = mapped_column(String(2000), nullable=False)
    treatment_status: Mapped[str] = mapped_column(String(24), nullable=False, default="in_progress")
    actor_id: Mapped[str] = mapped_column(String(36), nullable=False)
    actor_name: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class PatientObservationPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    attention_level: Literal["green", "yellow", "red"]
    observation: str = Field(min_length=5, max_length=2000)
    treatment_status: Literal["in_progress", "completed", "discharged"] = "in_progress"

    @field_validator("observation")
    @classmethod
    def trim_observation(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 5:
            raise ValueError("Registre uma observação objetiva com pelo menos cinco caracteres")
        return value


class Patient(Base):
    __tablename__ = "patients"

    reference: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    room: Mapped[str] = mapped_column(String(20), nullable=False)
    bed: Mapped[str] = mapped_column(String(20), nullable=False)
    cpf: Mapped[str] = mapped_column(String(11), nullable=False, default="")
    sus_card: Mapped[str] = mapped_column(String(20), nullable=False, default="")
    allergies: Mapped[str] = mapped_column(String(1000), nullable=False, default="")
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_by: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    deletion_reason: Mapped[str] = mapped_column(String(500), nullable=False, default="")
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
NUTRITION_ROLE = require_demo_role("nutrition")
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
    "oxygenStatus",
    "oxygenStartedAt",
    "oxygenEndedAt",
    "wounds",
    "dressingType",
    "examName",
    "examScheduledAt",
    "examFollowUp",
    "examResult",
}
NUMERIC_FIELDS = {"saturation", "heartRate", "respiratoryRate", "glucose", "pain"}
VITAL_FIELDS = {"saturation", "pressure", "heartRate", "respiratoryRate", "glucose"}


class PatientPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=2, max_length=120)
    room: str = Field(min_length=1, max_length=20)
    bed: str = Field(min_length=1, max_length=20)
    cpf: str = Field(default="", max_length=14)
    sus_card: str = Field(default="", max_length=20)
    allergies: str = Field(default="", max_length=1000)
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

    @field_validator("name", "room", "bed")
    @classmethod
    def trim_required_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Este campo é obrigatório")
        return value

    @field_validator("photo_data")
    @classmethod
    def validate_photo(cls, value: str) -> str:
        if value and not re.fullmatch(r"data:image/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}", value):
            raise ValueError("A foto deve ser uma imagem JPEG, PNG ou WebP válida")
        return value

    @field_validator("cpf")
    @classmethod
    def validate_cpf(cls, value: str) -> str:
        digits = re.sub(r"\D", "", value)
        if not digits:
            return ""
        if len(digits) != 11 or len(set(digits)) == 1:
            raise ValueError("Informe um CPF válido com 11 dígitos")
        for length in (9, 10):
            total = sum(int(digit) * (length + 1 - index) for index, digit in enumerate(digits[:length]))
            check = (total * 10 % 11) % 10
            if check != int(digits[length]):
                raise ValueError("Informe um CPF válido")
        return digits

    @field_validator("sus_card")
    @classmethod
    def normalize_sus_card(cls, value: str) -> str:
        return re.sub(r"\D", "", value)


class NutritionRecord(Base):
    __tablename__ = "nutrition_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    patient_reference: Mapped[str] = mapped_column(String(36), ForeignKey("patients.reference", ondelete="RESTRICT"), nullable=False, index=True)
    assessment_date: Mapped[date] = mapped_column(Date, nullable=False)
    weight_kg: Mapped[str] = mapped_column(String(12), nullable=False, default="")
    height_cm: Mapped[str] = mapped_column(String(12), nullable=False, default="")
    diet_type: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    allergies: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    restrictions: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    appetite: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    hydration: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    actor_id: Mapped[str] = mapped_column(String(36), nullable=False)
    actor_name: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    fasting_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    fasting_reason: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    voided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    voided_by: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    void_reason: Mapped[str] = mapped_column(String(500), nullable=False, default="")


class NutritionPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    patient_reference: str = Field(min_length=1, max_length=36)
    assessment_date: date
    weight_kg: str = Field(default="", max_length=12)
    height_cm: str = Field(default="", max_length=12)
    diet_type: str = Field(default="", max_length=80)
    allergies: str = Field(default="", max_length=500)
    restrictions: str = Field(default="", max_length=500)
    appetite: Literal["", "normal", "reduced", "poor", "increased"] = ""
    hydration: Literal["", "adequate", "low", "assisted"] = ""
    notes: str = Field(default="", max_length=3000)
    fasting_at: datetime | None = None
    fasting_reason: str = Field(default="", max_length=500)

    @field_validator("weight_kg", "height_cm")
    @classmethod
    def validate_measurement(cls, value: str) -> str:
        if value and not re.fullmatch(r"\d{1,3}(?:[.,]\d{1,2})?", value):
            raise ValueError("Informe uma medida numérica válida")
        return value


class VoidPayload(BaseModel):
    reason: str = Field(min_length=5, max_length=500)

    @field_validator("reason")
    @classmethod
    def trim_reason(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 5:
            raise ValueError("Informe um motivo com pelo menos 5 caracteres")
        return value


PATIENT_MODULES = ("patients", "nursing", "reception", "therapy", "nutrition", "social", "xray", "maintenance", "management")


async def authorize_patient_module(request: Request) -> DemoPrincipal:
    from .common import authenticated_principal

    principal = await authenticated_principal(request)
    action = {"GET": "consultar", "HEAD": "consultar", "POST": "criar", "PUT": "alterar", "PATCH": "alterar", "DELETE": "excluir"}.get(request.method.upper(), "consultar")
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
            if len(value) > (2000 if field == "examResult" else 1000):
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
    if not any(value.strip() for value in payload.values.values()) and not payload.not_applicable:
        raise HTTPException(status_code=422, detail="Informe ao menos um dado coletado ou marque os sinais aplicáveis como não aferidos")
    for field in payload.not_applicable:
        if payload.values.get(field, "").strip():
            raise HTTPException(status_code=422, detail="Um sinal não pode ter valor e estar marcado como não aferido")
    saturation = payload.values.get("saturation", "").replace(",", ".")
    if saturation and not 0 <= float(saturation) <= 100:
        raise HTTPException(status_code=422, detail="A saturação deve estar entre 0 e 100%")
    pressure = payload.values.get("pressure", "")
    if pressure:
        systolic, diastolic = (int(value) for value in pressure.split("/"))
        if systolic == 0 or diastolic == 0:
            raise HTTPException(status_code=422, detail="Informe os dois componentes da pressão arterial")
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
    emit_audit_event(principal, "nursing", "vitals_recorded", payload.patient_reference)
    return serialize_record(record)


@app.get("/api/v1/nursing/patients")
def list_patients(
    principal: Annotated[DemoPrincipal, PATIENT_ACCESS],
    db: Annotated[Session, Depends(get_nursing_db)],
    full_profile: bool = False,
    include_inactive: bool = False,
    include_archived: bool = False,
) -> dict[str, list[dict[str, object]]]:
    if full_profile and not can_view_full_patient_profile(principal):
        raise HTTPException(status_code=403, detail="Acesso aos dados cadastrais completos não autorizado")
    query = select(Patient).order_by(Patient.active.desc(), Patient.room, Patient.bed)
    if not include_inactive:
        query = query.where(Patient.active.is_(True))
    elif not include_archived:
        query = query.where(Patient.deleted_at.is_(None))
    patients = db.scalars(query).all()
    emit_audit_event(principal, "patients", "patient_list_read", "patient_registry")
    return {"patients": [serialize_patient(patient, principal=principal, full_profile=full_profile) for patient in patients]}


@app.get("/api/v1/nursing/patients/duplicates")
def find_patient_duplicates(
    principal: Annotated[DemoPrincipal, PATIENT_ACCESS],
    db: Annotated[Session, Depends(get_nursing_db)],
    name: str = "",
    cpf: str = "",
    sus_card: str = "",
    exclude_reference: str = "",
) -> dict[str, list[dict[str, str]]]:
    name_key = " ".join(re.findall(r"[\w]+", name.casefold()))
    cpf_key = re.sub(r"\D", "", cpf)
    sus_key = re.sub(r"\D", "", sus_card)
    if not (name_key or cpf_key or sus_key):
        return {"matches": []}
    candidates = db.scalars(select(Patient).where(Patient.active.is_(True), Patient.reference != exclude_reference)).all()
    matches = []
    for candidate in candidates:
        reasons = []
        if cpf_key and candidate.cpf == cpf_key:
            reasons.append("CPF")
        if sus_key and candidate.sus_card == sus_key:
            reasons.append("Cartão SUS")
        if name_key and " ".join(re.findall(r"[\w]+", candidate.name.casefold())) == name_key:
            reasons.append("nome igual")
        if reasons:
            matches.append({"reference": candidate.reference, "name": candidate.name, "room": candidate.room, "bed": candidate.bed, "reasons": ", ".join(reasons)})
    emit_audit_event(principal, "patients", "patient_duplicate_check", "patient_registry")
    return {"matches": matches[:20]}


@app.get("/api/v1/nursing/patients/{patient_reference}")
def get_patient(
    patient_reference: str,
    principal: Annotated[DemoPrincipal, PATIENT_ACCESS],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, object]:
    patient = db.get(Patient, patient_reference)
    if patient is None:
        raise HTTPException(status_code=404, detail="Paciente não encontrado")
    full_profile = can_view_full_patient_profile(principal)
    emit_audit_event(principal, "patients", "patient_record_read", patient_reference)
    return serialize_patient(patient, principal=principal, full_profile=full_profile)


@app.delete("/api/v1/nursing/patients/{patient_reference}")
def delete_patient(
    patient_reference: str,
    payload: VoidPayload,
    principal: Annotated[DemoPrincipal, PATIENT_ACCESS],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, object]:
    patient = db.get(Patient, patient_reference)
    if patient is None:
        raise HTTPException(status_code=404, detail="Paciente não encontrado")
    patient.active = False
    patient.deleted_at = datetime.now(UTC)
    patient.deleted_by = principal.actor_name
    patient.deletion_reason = payload.reason.strip()
    patient.updated_at = datetime.now(UTC)
    patient.updated_by = principal.actor_name
    db.commit()
    emit_audit_event(principal, "patients", "patient_archived", patient.reference)
    return {"reference": patient.reference, "active": False}


@app.post("/internal/v1/patients/resolve")
def resolve_patient(
    payload: dict[str, str],
    db: Annotated[Session, Depends(get_nursing_db)],
    _: Annotated[None, Depends(require_service_token)],
) -> dict[str, str]:
    reference = payload.get("reference", "")
    patient = db.get(Patient, reference)
    if patient is None or not patient.active:
        raise HTTPException(status_code=404, detail="Paciente não encontrado ou inativo")
    return {"reference": patient.reference, "name": patient.name, "room": patient.room, "bed": patient.bed}


@app.post("/api/v1/nursing/patients", status_code=201)
def create_patient(
    payload: PatientPayload,
    principal: Annotated[DemoPrincipal, PATIENT_ACCESS],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, object]:
    if payload.cpf and db.scalar(select(Patient.reference).where(Patient.cpf == payload.cpf)):
        raise HTTPException(status_code=409, detail="Já existe um paciente cadastrado com este CPF")
    if payload.sus_card and db.scalar(select(Patient.reference).where(Patient.sus_card == payload.sus_card)):
        raise HTTPException(status_code=409, detail="Já existe um paciente cadastrado com este Cartão SUS")
    if db.scalar(select(Patient.reference).where(Patient.active.is_(True), Patient.room == payload.room.strip(), Patient.bed == payload.bed.strip())):
        raise HTTPException(status_code=409, detail="Este quarto e leito já estão ocupados")
    patient = Patient(reference=str(uuid.uuid4()), **payload.model_dump(), created_at=datetime.now(UTC), updated_at=datetime.now(UTC), updated_by=principal.actor_name)
    db.add(patient)
    db.commit()
    db.refresh(patient)
    emit_audit_event(principal, "patients", "patient_created", patient.reference)
    return serialize_patient(patient, principal=principal, full_profile=can_view_full_patient_profile(principal))


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
    if payload.cpf and db.scalar(select(Patient.reference).where(Patient.cpf == payload.cpf, Patient.reference != patient_reference)):
        raise HTTPException(status_code=409, detail="Já existe um paciente cadastrado com este CPF")
    if payload.sus_card and db.scalar(select(Patient.reference).where(Patient.sus_card == payload.sus_card, Patient.reference != patient_reference)):
        raise HTTPException(status_code=409, detail="Já existe um paciente cadastrado com este Cartão SUS")
    if patient.active and db.scalar(select(Patient.reference).where(Patient.active.is_(True), Patient.room == payload.room.strip(), Patient.bed == payload.bed.strip(), Patient.reference != patient_reference)):
        raise HTTPException(status_code=409, detail="Este quarto e leito já estão ocupados")
    for key, value in payload.model_dump().items():
        setattr(patient, key, value)
    patient.updated_at = datetime.now(UTC)
    patient.updated_by = principal.actor_name
    db.commit()
    db.refresh(patient)
    emit_audit_event(principal, "patients", "patient_updated", patient.reference)
    return serialize_patient(patient, principal=principal, full_profile=can_view_full_patient_profile(principal))


@app.patch("/api/v1/nursing/patients/{patient_reference}/status")
def update_patient_status(
    patient_reference: str,
    payload: dict[str, bool],
    principal: Annotated[DemoPrincipal, PATIENT_ACCESS],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, object]:
    patient = db.get(Patient, patient_reference)
    if patient is None:
        raise HTTPException(status_code=404, detail="Paciente não encontrado")
    active = payload.get("active")
    if not isinstance(active, bool):
        raise HTTPException(status_code=422, detail="Informe a situação ativa do paciente")
    if active and not patient.active and db.scalar(select(Patient.reference).where(
        Patient.active.is_(True), Patient.room == patient.room, Patient.bed == patient.bed,
    )):
        raise HTTPException(status_code=409, detail="O quarto e leito deste paciente já estão ocupados")
    patient.active = active
    patient.updated_at = datetime.now(UTC)
    patient.updated_by = principal.actor_name
    db.commit()
    db.refresh(patient)
    emit_audit_event(principal, "patients", "patient_status_changed", patient.reference)
    return serialize_patient(patient, principal=principal, full_profile=can_view_full_patient_profile(principal))


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
    query = select(VitalRecord).where(VitalRecord.patient_reference == patient_reference, VitalRecord.voided_at.is_(None)).order_by(VitalRecord.recorded_at.desc())
    total = db.scalar(select(func.count(VitalRecord.id)).where(VitalRecord.patient_reference == patient_reference, VitalRecord.voided_at.is_(None))) or 0
    records = db.scalars(query.offset(offset).limit(limit)).all()
    emit_audit_event(_, "nursing", "patient_vitals_history_read", patient_reference)
    return {"records": [serialize_record(record) for record in records], "total": total, "limit": limit, "offset": offset}


@app.get("/api/v1/nursing/patients/{patient_reference}/observations")
def list_patient_observations(
    patient_reference: str,
    principal: Annotated[DemoPrincipal, PATIENT_HISTORY_ACCESS],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, list[dict[str, object]]]:
    if db.get(Patient, patient_reference) is None:
        raise HTTPException(status_code=404, detail="Paciente não encontrado")
    rows = db.scalars(select(PatientObservation).where(PatientObservation.patient_reference == patient_reference).order_by(PatientObservation.created_at.desc())).all()
    emit_audit_event(principal, "patients", "patient_observations_read", patient_reference)
    return {"observations": [{"id": row.id, "attention_level": row.attention_level, "observation": row.observation, "treatment_status": row.treatment_status, "actor_name": row.actor_name, "created_at": row.created_at.isoformat()} for row in rows]}


@app.post("/api/v1/nursing/patients/{patient_reference}/observations", status_code=201)
def create_patient_observation(
    patient_reference: str,
    payload: PatientObservationPayload,
    principal: Annotated[DemoPrincipal, PATIENT_ACCESS],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, object]:
    patient = db.get(Patient, patient_reference)
    if patient is None:
        raise HTTPException(status_code=404, detail="Paciente não encontrado")
    row = PatientObservation(patient_reference=patient_reference, attention_level=payload.attention_level, observation=payload.observation.strip(), treatment_status=payload.treatment_status, actor_id=principal.user_id, actor_name=principal.actor_name, created_at=datetime.now(UTC))
    db.add(row)
    db.commit()
    db.refresh(row)
    emit_audit_event(principal, "patients", "patient_observation_created", patient_reference)
    return {"id": row.id, "attention_level": row.attention_level, "observation": row.observation, "treatment_status": row.treatment_status, "actor_name": row.actor_name, "created_at": row.created_at.isoformat()}


@app.delete("/api/v1/nursing/vitals/{record_id}")
def void_vital_record(
    record_id: int,
    payload: VoidPayload,
    principal: Annotated[DemoPrincipal, Depends(NURSING_ROLE)],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, str]:
    record = db.get(VitalRecord, record_id)
    if record is None or record.voided_at is not None:
        raise HTTPException(status_code=404, detail="Registro não encontrado")
    record.voided_at = datetime.now(UTC)
    record.voided_by = principal.actor_name
    record.void_reason = payload.reason.strip()
    db.commit()
    emit_audit_event(principal, "nursing", "vital_record_voided", str(record.id))
    return {"status": "voided", "id": str(record.id)}


def can_view_full_patient_profile(principal: DemoPrincipal) -> bool:
    return any(module in principal.modules and "consultar" in principal.permissions.get(module, []) for module in ("patients", "reception", "management"))


def serialize_patient(patient: Patient, *, principal: DemoPrincipal, full_profile: bool = False) -> dict[str, object]:
    result: dict[str, object] = {
        "reference": patient.reference,
        "name": patient.name,
        "room": patient.room,
        "bed": patient.bed,
        "birth_date": patient.birth_date,
        "active": patient.active,
    }
    if full_profile or any(module in principal.modules and "consultar" in principal.permissions.get(module, []) for module in ("nursing", "nutrition")):
        result["allergies"] = patient.allergies
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
    filters.append(VitalRecord.voided_at.is_(None))
    if room or bed:
        records_query = records_query.join(Patient, Patient.reference == VitalRecord.patient_reference)
        count_query = count_query.join(Patient, Patient.reference == VitalRecord.patient_reference)
    records = db.scalars(
        records_query.where(*filters).order_by(VitalRecord.recorded_at.desc()).offset(offset).limit(limit)
    ).all()
    total = db.scalar(count_query.where(*filters)) or 0
    emit_audit_event(principal, "nursing", "vitals_query_read", patient_reference or "vitals_query")
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


@app.get("/api/v1/nursing/nutrition")
def list_nutrition_records(
    principal: Annotated[DemoPrincipal, Depends(NUTRITION_ROLE)],
    db: Annotated[Session, Depends(get_nursing_db)],
    patient_reference: str | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> dict[str, object]:
    query = select(NutritionRecord).where(NutritionRecord.voided_at.is_(None)).order_by(NutritionRecord.assessment_date.desc(), NutritionRecord.id.desc())
    if patient_reference:
        query = query.where(NutritionRecord.patient_reference == patient_reference)
    records = db.scalars(query.limit(limit)).all()
    emit_audit_event(principal, "nutrition", "nutrition_records_read", patient_reference or "nutrition_query")
    return {"records": [serialize_nutrition_record(record) for record in records]}


@app.get("/api/v1/nursing/patients/{patient_reference}/nutrition-plan")
def get_patient_nutrition_plan(
    patient_reference: str,
    principal: Annotated[DemoPrincipal, Depends(NURSING_ROLE)],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, object]:
    patient = db.get(Patient, patient_reference)
    if patient is None:
        raise HTTPException(status_code=404, detail="Paciente não encontrado")
    records = db.scalars(select(NutritionRecord).where(
        NutritionRecord.patient_reference == patient_reference,
        NutritionRecord.voided_at.is_(None),
    ).order_by(NutritionRecord.assessment_date.desc(), NutritionRecord.id.desc()).limit(10)).all()
    next_fast = db.scalar(select(NutritionRecord).where(
        NutritionRecord.patient_reference == patient_reference,
        NutritionRecord.voided_at.is_(None), NutritionRecord.fasting_at >= datetime.now(UTC),
    ).order_by(NutritionRecord.fasting_at).limit(1))
    emit_audit_event(principal, "nursing", "patient_nutrition_plan_read", patient_reference)
    return {
        "allergies": patient.allergies,
        "assessment_date": records[0].assessment_date.isoformat() if records else None,
        "diet_type": records[0].diet_type if records else "",
        "restrictions": records[0].restrictions if records else "",
        "fasting_at": next_fast.fasting_at.isoformat() if next_fast and next_fast.fasting_at else None,
        "fasting_reason": next_fast.fasting_reason if next_fast else "",
    }


@app.post("/api/v1/nursing/nutrition", status_code=201)
def create_nutrition_record(
    payload: NutritionPayload,
    principal: Annotated[DemoPrincipal, Depends(NUTRITION_ROLE)],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, object]:
    if db.get(Patient, payload.patient_reference) is None:
        raise HTTPException(status_code=404, detail="Paciente não encontrado")
    patient = db.get(Patient, payload.patient_reference)
    if patient is None or not patient.active:
        raise HTTPException(status_code=404, detail="Paciente não encontrado ou inativo")
    if payload.allergies.strip() and payload.allergies.strip() != patient.allergies:
        patient.allergies = payload.allergies.strip()
        patient.updated_at = datetime.now(UTC)
        patient.updated_by = principal.actor_name
        emit_audit_event(principal, "patients", "patient_allergies_updated", patient.reference)
    record = NutritionRecord(
        **payload.model_dump(), actor_id=principal.user_id, actor_name=principal.actor_name,
        created_at=datetime.now(UTC),
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    emit_audit_event(principal, "nutrition", "nutrition_record_created", payload.patient_reference)
    return serialize_nutrition_record(record)


@app.delete("/api/v1/nursing/nutrition/{record_id}")
def void_nutrition_record(
    record_id: int,
    payload: VoidPayload,
    principal: Annotated[DemoPrincipal, Depends(NUTRITION_ROLE)],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, str]:
    record = db.get(NutritionRecord, record_id)
    if record is None or record.voided_at is not None:
        raise HTTPException(status_code=404, detail="Avaliação não encontrada")
    record.voided_at = datetime.now(UTC)
    record.voided_by = principal.actor_name
    record.void_reason = payload.reason.strip()
    db.commit()
    emit_audit_event(principal, "nutrition", "nutrition_record_voided", str(record.id))
    return {"status": "voided", "id": str(record.id)}


def serialize_nutrition_record(record: NutritionRecord) -> dict[str, object]:
    return {
        "id": record.id, "patient_reference": record.patient_reference,
        "assessment_date": record.assessment_date.isoformat(), "weight_kg": record.weight_kg,
        "height_cm": record.height_cm, "diet_type": record.diet_type, "allergies": record.allergies,
        "restrictions": record.restrictions, "appetite": record.appetite, "hydration": record.hydration,
        "notes": record.notes, "actor_name": record.actor_name, "created_at": record.created_at.isoformat(),
        "fasting_at": record.fasting_at.isoformat() if record.fasting_at else None,
        "fasting_reason": record.fasting_reason,
    }
