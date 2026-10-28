import os
import re
import uuid
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal, InvalidOperation
from enum import IntEnum
from pathlib import Path
from typing import Annotated, Literal
from zoneinfo import ZoneInfo

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    case,
    exists,
    func,
    or_,
    select,
    text,
)
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Mapped, Session, mapped_column

from .common import (
    Base,
    DemoPrincipal,
    audit_outbox_lifespan,
    database_session,
    emit_audit_event,
    require_demo_role,
    require_demo_role_or_superuser,
    require_service_token,
    resolve_medication_dispensation,
    verify_database_migrated,
)


class VitalRecord(Base):
    __tablename__ = "vital_records"
    __table_args__ = (Index("ix_vital_records_patient_measured_at", "patient_reference", "measured_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    patient_reference: Mapped[str] = mapped_column(String(36), ForeignKey("patients.reference", ondelete="RESTRICT"), nullable=False)
    actor_id: Mapped[str] = mapped_column(String(36), nullable=False)
    actor_name: Mapped[str] = mapped_column(String(120), nullable=False)
    values: Mapped[dict[str, str]] = mapped_column(JSON, nullable=False)
    glucose_unit: Mapped[str] = mapped_column(String(12), nullable=False)
    not_applicable: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    measured_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    voided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    voided_by: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    void_reason: Mapped[str] = mapped_column(String(500), nullable=False, default="")


class VitalTrendPeriod(IntEnum):
    SIX_HOURS = 6
    ONE_DAY = 24
    SEVEN_DAYS = 168
    THIRTY_DAYS = 720


class BehavioralObservation(Base):
    __tablename__ = "behavioral_observations"
    __table_args__ = (
        Index(
            "ix_behavioral_observations_patient_created",
            "patient_reference",
            "created_at",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    patient_reference: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("patients.reference", ondelete="RESTRICT"),
        nullable=False,
    )
    observation: Mapped[str] = mapped_column(String(2000), nullable=False)
    context: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    response: Mapped[str] = mapped_column(String(1000), nullable=False, default="")
    status: Mapped[str | None] = mapped_column(String(8), nullable=True)
    actor_id: Mapped[str] = mapped_column(String(36), nullable=False)
    actor_name: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class BehavioralObservationPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    observation: str = Field(min_length=5, max_length=2000)
    context: str = Field(default="", max_length=500)
    response: str = Field(default="", max_length=1000)
    status: Literal["green", "yellow", "red"] | None = None

    @field_validator("observation")
    @classmethod
    def trim_observation(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 5:
            raise ValueError("Descreva objetivamente o comportamento observado")
        return value

    @field_validator("context", "response")
    @classmethod
    def trim_optional_fields(cls, value: str) -> str:
        return value.strip()


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
    mother_name: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    health_plan: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    same_number: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    room: Mapped[str] = mapped_column(String(20), nullable=False)
    bed: Mapped[str] = mapped_column(String(20), nullable=False)
    cpf: Mapped[str] = mapped_column(String(11), nullable=False, default="")
    sus_card: Mapped[str] = mapped_column(String(20), nullable=False, default="")
    allergies: Mapped[str] = mapped_column(String(1000), nullable=False, default="")
    allergies_status: Mapped[str] = mapped_column(String(16), nullable=False, default="unknown")
    treatment_track: Mapped[str] = mapped_column(String(20), nullable=False, default="unclassified")
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
    responsible_status: Mapped[str] = mapped_column(String(16), nullable=False, default="unknown")
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
    elopement_risk: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class NursingHourlyRound(Base):
    __tablename__ = "nursing_hourly_rounds"
    __table_args__ = (
        Index(
            "uq_nursing_hourly_rounds_open",
            "status",
            unique=True,
            sqlite_where=text("status = 'open'"),
            postgresql_where=text("status = 'open'"),
        ),
        Index("ix_nursing_hourly_rounds_started_at", "started_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="open")
    started_by_id: Mapped[str] = mapped_column(String(36), nullable=False)
    started_by_name: Mapped[str] = mapped_column(String(120), nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    completed_by_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    completed_by_name: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class NursingHourlyRoundPatient(Base):
    __tablename__ = "nursing_hourly_round_patients"
    __table_args__ = (
        Index(
            "uq_nursing_hourly_round_patients_reference",
            "round_id",
            "patient_reference",
            unique=True,
        ),
        Index("ix_nursing_hourly_round_patients_round_status", "round_id", "status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    round_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("nursing_hourly_rounds.id", ondelete="CASCADE"),
        nullable=False,
    )
    patient_reference: Mapped[str] = mapped_column(String(36), nullable=False)
    patient_name: Mapped[str] = mapped_column(String(120), nullable=False)
    room: Mapped[str] = mapped_column(String(20), nullable=False)
    bed: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    exception_type: Mapped[str] = mapped_column(String(24), nullable=False, default="")
    note: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    elopement_risk: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    checked_by_id: Mapped[str] = mapped_column(String(36), nullable=False, default="")
    checked_by_name: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class NursingHourlyRoundPatientPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["checked", "exception"]
    exception_type: Literal["away", "location", "not_found", "other"] | None = None
    note: str = Field(default="", max_length=500)

    @field_validator("note")
    @classmethod
    def trim_note(cls, value: str) -> str:
        return value.strip()

    @model_validator(mode="after")
    def validate_result(self) -> "NursingHourlyRoundPatientPayload":
        if self.status == "exception":
            if self.exception_type is None or len(self.note) < 3:
                raise ValueError("Selecione a ocorrência e descreva brevemente")
        elif self.exception_type is not None or self.note:
            raise ValueError("Observação de ocorrência somente para exceções")
        return self


def validate_cpf_number(value: str) -> str:
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


class EmergencyArrival(Base):
    __tablename__ = "emergency_arrivals"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    patient_reference: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("patients.reference", ondelete="SET NULL"), nullable=True
    )
    patient_name: Mapped[str] = mapped_column(String(120), nullable=False)
    arrival_mode: Mapped[str] = mapped_column(String(16), nullable=False)
    reason: Mapped[str] = mapped_column(String(1000), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    created_by: Mapped[str] = mapped_column(String(120), nullable=False)
    updated_by: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    clinical_priority: Mapped[str] = mapped_column(String(16), nullable=False, default="unassigned")
    queue_type: Mapped[str] = mapped_column(String(12), nullable=False, default="common")
    clinical_priority_updated_by: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    clinical_priority_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    clinical_priority_reason: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    allergy_report_status: Mapped[str] = mapped_column(String(16), nullable=False, default="not_asked")
    reported_allergies: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    announcement_version: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class NursingTriage(Base):
    __tablename__ = "nursing_triages"
    __table_args__ = (
        Index("ix_nursing_triages_arrival_created", "arrival_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    arrival_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("emergency_arrivals.id", ondelete="RESTRICT"), nullable=False
    )
    patient_reference: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("patients.reference", ondelete="SET NULL"), nullable=True
    )
    allergies_status: Mapped[str] = mapped_column(String(16), nullable=False)
    allergies: Mapped[str] = mapped_column(String(1000), nullable=False, default="")
    conditions_treatments: Mapped[str] = mapped_column(Text, nullable=False, default="")
    vital_values: Mapped[dict[str, str]] = mapped_column(JSON, nullable=False, default=dict)
    glucose_unit: Mapped[str] = mapped_column(String(12), nullable=False, default="mg/dL")
    measured_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    actor_id: Mapped[str] = mapped_column(String(36), nullable=False)
    actor_name: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class ReceptionQueueSettings(Base):
    __tablename__ = "reception_queue_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    normal_before_priority: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    normal_calls_since_priority: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_by: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class OutpatientEncounter(Base):
    __tablename__ = "outpatient_encounters"
    __table_args__ = (Index("ix_outpatient_encounters_patient_created", "patient_reference", "created_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    patient_reference: Mapped[str] = mapped_column(
        String(36), ForeignKey("patients.reference", ondelete="RESTRICT"), nullable=False
    )
    patient_snapshot: Mapped[dict[str, str]] = mapped_column(JSON, nullable=False)
    encounter_type: Mapped[str] = mapped_column(String(32), nullable=False)
    physician_name: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    examination: Mapped[str] = mapped_column(String(1000), nullable=False, default="")
    activity_rows: Mapped[list[dict[str, str]]] = mapped_column(JSON, nullable=False)
    group_name: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    programs: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    diagnostic_hypothesis: Mapped[str] = mapped_column(String(2000), nullable=False, default="")
    antibiotic_prescription: Mapped[str] = mapped_column(String(2000), nullable=False, default="")
    referral: Mapped[str] = mapped_column(String(32), nullable=False)
    created_by: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class ReceptionAppointment(Base):
    __tablename__ = "reception_appointments"
    __table_args__ = (
        Index("ix_reception_appointments_patient_start", "patient_reference", "starts_at"),
        Index("ix_reception_appointments_status_start", "status", "starts_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    patient_reference: Mapped[str] = mapped_column(
        String(36), ForeignKey("patients.reference", ondelete="RESTRICT"), nullable=False
    )
    appointment_type: Mapped[str] = mapped_column(String(16), nullable=False)
    professional_name: Mapped[str] = mapped_column(String(120), nullable=False)
    location: Mapped[str] = mapped_column(String(120), nullable=False)
    purpose: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="scheduled")
    created_by: Mapped[str] = mapped_column(String(36), nullable=False)
    created_by_name: Mapped[str] = mapped_column(String(120), nullable=False)
    updated_by_name: Mapped[str] = mapped_column(String(120), nullable=False)
    arrived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    announcement_version: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class PatientFlowEvent(Base):
    __tablename__ = "patient_flow_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    patient_reference: Mapped[str] = mapped_column(String(36), ForeignKey("patients.reference", ondelete="RESTRICT"), nullable=False)
    event_type: Mapped[str] = mapped_column(String(16), nullable=False)
    previous_room: Mapped[str] = mapped_column(String(20), nullable=False, default="")
    previous_bed: Mapped[str] = mapped_column(String(20), nullable=False, default="")
    next_room: Mapped[str] = mapped_column(String(20), nullable=False, default="")
    next_bed: Mapped[str] = mapped_column(String(20), nullable=False, default="")
    reason: Mapped[str] = mapped_column(String(500), nullable=False)
    summary: Mapped[str] = mapped_column(String(2000), nullable=False, default="")
    actor_id: Mapped[str] = mapped_column(String(36), nullable=False)
    actor_name: Mapped[str] = mapped_column(String(120), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class HospitalUnit(Base):
    __tablename__ = "hospital_units"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_by: Mapped[str] = mapped_column(String(120), nullable=False)


class HospitalBed(Base):
    __tablename__ = "hospital_beds"
    __table_args__ = (
        Index("ix_hospital_beds_hygiene_request_id", "hygiene_request_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    unit_id: Mapped[str] = mapped_column(ForeignKey("hospital_units.id", ondelete="RESTRICT"), nullable=False)
    room: Mapped[str] = mapped_column(String(20), nullable=False)
    label: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="available")
    isolation_capable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    notes: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    hygiene_request_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_by: Mapped[str] = mapped_column(String(120), nullable=False)


class BedAssignment(Base):
    __tablename__ = "bed_assignments"
    __table_args__ = (
        Index(
            "uq_bed_assignments_active_bed",
            "bed_id",
            unique=True,
            sqlite_where=text("released_at IS NULL"),
            postgresql_where=text("released_at IS NULL"),
        ),
        Index(
            "uq_bed_assignments_active_patient",
            "patient_reference",
            unique=True,
            sqlite_where=text("released_at IS NULL"),
            postgresql_where=text("released_at IS NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    bed_id: Mapped[str] = mapped_column(ForeignKey("hospital_beds.id", ondelete="RESTRICT"), nullable=False)
    patient_reference: Mapped[str] = mapped_column(ForeignKey("patients.reference", ondelete="RESTRICT"), nullable=False)
    assigned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    assigned_by: Mapped[str] = mapped_column(String(120), nullable=False)
    released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    released_by: Mapped[str] = mapped_column(String(120), nullable=False, default="")


class PatientAllergyHistory(Base):
    __tablename__ = "patient_allergy_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    patient_reference: Mapped[str] = mapped_column(String(36), ForeignKey("patients.reference", ondelete="RESTRICT"), nullable=False)
    previous_status: Mapped[str] = mapped_column(String(16), nullable=False)
    previous_details: Mapped[str] = mapped_column(String(1000), nullable=False, default="")
    new_status: Mapped[str] = mapped_column(String(16), nullable=False)
    new_details: Mapped[str] = mapped_column(String(1000), nullable=False, default="")
    reason: Mapped[str] = mapped_column(String(300), nullable=False)
    actor_id: Mapped[str] = mapped_column(String(36), nullable=False)
    actor_name: Mapped[str] = mapped_column(String(120), nullable=False)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class ClinicalRisk(Base):
    __tablename__ = "clinical_risks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    patient_reference: Mapped[str] = mapped_column(String(36), ForeignKey("patients.reference", ondelete="RESTRICT"), nullable=False)
    risk_type: Mapped[str] = mapped_column(String(24), nullable=False)
    description: Mapped[str] = mapped_column(String(1000), nullable=False)
    severity: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")
    reason: Mapped[str] = mapped_column(String(300), nullable=False)
    actor_id: Mapped[str] = mapped_column(String(36), nullable=False)
    actor_name: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_by: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    resolution_reason: Mapped[str] = mapped_column(String(300), nullable=False, default="")


class PatientSafetyIncident(Base):
    __tablename__ = "patient_safety_incidents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    incident_type: Mapped[str] = mapped_column(String(32), nullable=False)
    severity: Mapped[str] = mapped_column(String(16), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    unit: Mapped[str] = mapped_column(String(100), nullable=False)
    location: Mapped[str] = mapped_column(String(120), nullable=False)
    patient_reference: Mapped[str | None] = mapped_column(ForeignKey("patients.reference", ondelete="SET NULL"), nullable=True)
    description: Mapped[str] = mapped_column(String(2000), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="open")
    investigation: Mapped[str] = mapped_column(String(2000), nullable=False, default="")
    corrective_action: Mapped[str] = mapped_column(String(2000), nullable=False, default="")
    reported_by: Mapped[str] = mapped_column(String(120), nullable=False)
    updated_by: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class InstitutionalDocument(Base):
    __tablename__ = "institutional_documents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    document_type: Mapped[str] = mapped_column(String(40), nullable=False)
    version: Mapped[str] = mapped_column(String(24), nullable=False)
    content: Mapped[str] = mapped_column(String(10000), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft")
    valid_until: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_by: Mapped[str] = mapped_column(String(120), nullable=False)
    approved_by: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class MedicationAdministration(Base):
    __tablename__ = "medication_administrations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    dispensation_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    patient_reference: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    medication_name: Mapped[str] = mapped_column(String(120), nullable=False)
    dose: Mapped[str] = mapped_column(String(80), nullable=False)
    unit: Mapped[str] = mapped_column(String(24), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    reason: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    actor_id: Mapped[str] = mapped_column(String(36), nullable=False)
    actor_name: Mapped[str] = mapped_column(String(120), nullable=False)
    administered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class ScheduledMedicationAdministration(Base):
    __tablename__ = "scheduled_medication_administrations"
    __table_args__ = (
        UniqueConstraint(
            "prescription_reference",
            "scheduled_date",
            "scheduled_time",
            name="uq_scheduled_med_admin_prescription_date_time",
        ),
        Index("ix_scheduled_med_admin_date_time", "scheduled_date", "scheduled_time"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    prescription_reference: Mapped[str] = mapped_column(String(36), nullable=False)
    patient_reference: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    scheduled_date: Mapped[date] = mapped_column(Date, nullable=False)
    scheduled_time: Mapped[str] = mapped_column(String(5), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    reason: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    actor_id: Mapped[str] = mapped_column(String(36), nullable=False)
    actor_name: Mapped[str] = mapped_column(String(120), nullable=False)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class PhysicianProfile(Base):
    __tablename__ = "physician_profiles"

    user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    crm: Mapped[str] = mapped_column(String(24), nullable=False)
    crm_state: Mapped[str] = mapped_column(String(2), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class PhysicianPrescription(Base):
    __tablename__ = "physician_prescriptions"
    __table_args__ = (
        Index("ix_physician_prescriptions_status_created", "status", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    patient_reference: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    medication_name: Mapped[str] = mapped_column(String(160), nullable=False)
    active_ingredient: Mapped[str] = mapped_column(String(160), nullable=False, default="")
    presentation: Mapped[str] = mapped_column(String(160), nullable=False, default="")
    dose: Mapped[str] = mapped_column(String(120), nullable=False)
    route: Mapped[str] = mapped_column(String(80), nullable=False)
    frequency: Mapped[str] = mapped_column(String(160), nullable=False)
    administration_times: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    duration: Mapped[str] = mapped_column(String(120), nullable=False)
    quantity: Mapped[str] = mapped_column(String(40), nullable=False)
    unit: Mapped[str] = mapped_column(String(40), nullable=False)
    instructions: Mapped[str] = mapped_column(String(1000), nullable=False, default="")
    is_controlled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    prescriber_id: Mapped[str] = mapped_column(String(36), nullable=False)
    prescriber_name: Mapped[str] = mapped_column(String(120), nullable=False)
    crm: Mapped[str] = mapped_column(String(24), nullable=False)
    crm_state: Mapped[str] = mapped_column(String(2), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class EmergencyArrivalPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    patient_reference: str | None = Field(default=None, max_length=36)
    patient_name: str = Field(default="", max_length=120)
    new_patient: "EmergencyPatientPayload | None" = None
    arrival_mode: Literal["walk_in", "ambulance", "other"] = "walk_in"
    reason: str = Field(min_length=3, max_length=1000)
    queue_type: Literal["common", "priority"] = "common"
    allergy_report_status: Literal["not_asked", "reported", "denied"] = "not_asked"
    reported_allergies: str = Field(default="", max_length=500)

    @model_validator(mode="after")
    def validate_patient_source(self) -> "EmergencyArrivalPayload":
        if self.new_patient and self.patient_reference:
            raise ValueError("Escolha um paciente existente ou crie um novo cadastro")
        if not self.new_patient and not self.patient_reference and len(self.patient_name.strip()) < 2:
            raise ValueError("Informe o nome da pessoa atendida")
        if self.allergy_report_status == "reported" and not self.reported_allergies.strip():
            raise ValueError("Descreva a alergia relatada pelo paciente ou acompanhante")
        if self.allergy_report_status != "reported" and self.reported_allergies.strip():
            raise ValueError("Informe detalhes somente quando uma alergia tiver sido relatada")
        return self

    @field_validator("reason")
    @classmethod
    def trim_reason(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 3:
            raise ValueError("Informe o motivo da procura")
        return value


class NursingTriagePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    allergies_status: Literal["unknown", "none_known", "known"] = "unknown"
    allergies: str = Field(default="", max_length=1000)
    conditions_treatments: str = Field(default="", max_length=2000)
    vital_values: dict[str, str] = Field(default_factory=dict)
    glucose_unit: Literal["mg/dL", "mmol/L"] = "mg/dL"
    measured_at: datetime | None = None

    @field_validator("allergies", "conditions_treatments")
    @classmethod
    def trim_triage_text(cls, value: str) -> str:
        return value.strip()

    @field_validator("vital_values")
    @classmethod
    def validate_triage_vitals(cls, values: dict[str, str]) -> dict[str, str]:
        return validate_vital_values(values, TRIAGE_VITAL_FIELDS)

    @field_validator("measured_at")
    @classmethod
    def validate_measured_at(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.tzinfo is None:
            raise ValueError("O horário da aferição deve incluir fuso horário")
        return value

    @model_validator(mode="after")
    def validate_allergies(self) -> "NursingTriagePayload":
        if self.allergies_status == "known" and not self.allergies:
            raise ValueError("Descreva a alergia relatada ou confirmada")
        if self.allergies_status != "known" and self.allergies:
            raise ValueError("Descreva alergias somente quando o status for 'known'")
        return self


class ReceptionQueueSettingsPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    normal_before_priority: int = Field(ge=1, le=20)


class ReceptionQueueCallPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["automatic", "common", "priority"] = "automatic"


class EmergencyPatientPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=2, max_length=120)
    cpf: str = Field(default="", max_length=14)
    sus_card: str = Field(default="", max_length=20)
    birth_date: date | None = None
    mother_name: str = Field(default="", max_length=120)
    health_plan: str = Field(default="", max_length=120)
    same_number: str = Field(default="", max_length=40)
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
    responsible_status: Literal["unknown", "not_applicable", "provided"] = "unknown"
    responsible_relationship: str = Field(default="", max_length=60)
    responsible_phone: str = Field(default="", max_length=40)
    responsible_address: str = Field(default="", max_length=180)
    responsible_address_number: str = Field(default="", max_length=24)
    responsible_address_complement: str = Field(default="", max_length=100)
    responsible_neighborhood: str = Field(default="", max_length=100)
    responsible_city: str = Field(default="", max_length=100)
    responsible_state: str = Field(default="", max_length=2)
    responsible_postal_code: str = Field(default="", max_length=12)
    allergies: str = Field(default="", max_length=1000)
    allergies_status: Literal["unknown", "none_known", "known"] = "unknown"

    @field_validator("name")
    @classmethod
    def trim_name(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 2:
            raise ValueError("Informe o nome completo")
        return value

    @field_validator("cpf")
    @classmethod
    def validate_cpf(cls, value: str) -> str:
        return validate_cpf_number(value)

    @field_validator("sus_card")
    @classmethod
    def normalize_sus_card(cls, value: str) -> str:
        return re.sub(r"\D", "", value)

    @field_validator("allergies")
    @classmethod
    def trim_allergies(cls, value: str) -> str:
        return value.strip()

    @model_validator(mode="after")
    def validate_allergy_status(self) -> "EmergencyPatientPayload":
        if self.allergies_status == "known" and not self.allergies:
            raise ValueError("Descreva a alergia conhecida")
        if self.allergies_status != "known" and self.allergies:
            raise ValueError("Descreva alergias somente quando o status for 'known'")
        return self

EmergencyArrivalPayload.model_rebuild()


class ReceptionAppointmentPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    patient_reference: str = Field(min_length=1, max_length=36)
    appointment_type: Literal["consultation", "exam", "procedure", "return"]
    professional_name: str = Field(min_length=2, max_length=120)
    location: str = Field(min_length=2, max_length=120)
    purpose: str = Field(default="", max_length=300)
    starts_at: datetime
    ends_at: datetime

    @field_validator("professional_name", "location", "purpose")
    @classmethod
    def trim_text(cls, value: str) -> str:
        return value.strip()

    @field_validator("starts_at", "ends_at")
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("Informe data e horário com fuso horário")
        return value.astimezone(UTC)

    @model_validator(mode="after")
    def validate_interval(self) -> "ReceptionAppointmentPayload":
        duration = self.ends_at - self.starts_at
        if duration <= timedelta(0) or duration > timedelta(hours=8):
            raise ValueError("O horário final deve ser posterior ao inicial e limitado a 8 horas")
        if self.starts_at <= datetime.now(UTC):
            raise ValueError("O agendamento deve começar no futuro")
        if len(self.professional_name) < 2 or len(self.location) < 2:
            raise ValueError("Informe profissional e local válidos")
        return self


class ReceptionAppointmentStatusPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["confirmed", "arrived", "called", "completed", "cancelled", "no_show"]


class EmergencyArrivalStatusPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["waiting", "called", "in_service", "completed", "cancelled"]


class EmergencyAdmissionPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    bed_id: str = Field(min_length=1, max_length=36)
    treatment_track: Literal["clinical", "psychiatric", "combined", "unclassified"] = "unclassified"


class PatientTransferPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    bed_id: str = Field(min_length=1, max_length=36)
    reason: str = Field(min_length=3, max_length=500)

    @field_validator("bed_id", "reason")
    @classmethod
    def trim_transfer_fields(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Selecione o leito de destino e informe o motivo da transferência")
        return value


class HospitalUnitPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=2, max_length=100)

    @field_validator("name")
    @classmethod
    def trim_unit_name(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 2:
            raise ValueError("Informe o nome da unidade")
        return value


class HospitalBedPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    unit_id: str = Field(min_length=1, max_length=36)
    room: str = Field(min_length=1, max_length=20)
    label: str = Field(min_length=1, max_length=20)
    isolation_capable: bool = False
    notes: str = Field(default="", max_length=300)

    @field_validator("unit_id", "room", "label")
    @classmethod
    def trim_bed_fields(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Preencha unidade, quarto e identificação do leito")
        return value

    @field_validator("notes")
    @classmethod
    def trim_bed_notes(cls, value: str) -> str:
        return value.strip()


class HospitalBedStatusPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["available", "cleaning", "maintenance", "blocked"]


class InternalHospitalBedCleaningPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["start", "release", "rollback"]
    request_id: str = Field(min_length=1, max_length=36)
    actor_id: str = Field(min_length=1, max_length=36)
    actor_name: str = Field(min_length=2, max_length=120)


class PatientBedReconciliationPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    bed_id: str = Field(min_length=1, max_length=36)

    @field_validator("bed_id")
    @classmethod
    def trim_bed_id(cls, value: str) -> str:
        return value.strip()


class PatientDischargePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: str = Field(min_length=3, max_length=500)
    summary: str = Field(default="", max_length=2000)

    @field_validator("reason", "summary")
    @classmethod
    def trim_discharge_fields(cls, value: str) -> str:
        return value.strip()


class ClinicalRiskPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    description: str = Field(min_length=3, max_length=1000)
    severity: Literal["unspecified", "low", "moderate", "high"] = "unspecified"
    reason: str = Field(min_length=3, max_length=300)

    @field_validator("description", "reason")
    @classmethod
    def trim_risk_fields(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 3:
            raise ValueError("Informe os detalhes do risco e o motivo do registro")
        return value


class ClinicalRiskResolutionPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: str = Field(min_length=3, max_length=300)

    @field_validator("reason")
    @classmethod
    def trim_resolution_reason(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 3:
            raise ValueError("Informe o motivo da resolução")
        return value


class PatientSafetyIncidentPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    incident_type: Literal["medication", "fall", "identification", "infection", "equipment", "other"]
    severity: Literal["near_miss", "mild", "moderate", "severe", "critical"]
    occurred_at: datetime
    unit: str = Field(min_length=2, max_length=100)
    location: str = Field(min_length=2, max_length=120)
    patient_reference: str | None = Field(default=None, max_length=36)
    description: str = Field(min_length=5, max_length=2000)

    @field_validator("unit", "location", "description")
    @classmethod
    def trim_incident_text(cls, value: str) -> str:
        return value.strip()


class PatientSafetyIncidentUpdatePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["investigating", "action_required", "closed"]
    investigation: str = Field(default="", max_length=2000)
    corrective_action: str = Field(default="", max_length=2000)

    @field_validator("investigation", "corrective_action")
    @classmethod
    def trim_incident_followup(cls, value: str) -> str:
        return value.strip()

    @model_validator(mode="after")
    def validate_closure_action(self) -> "PatientSafetyIncidentUpdatePayload":
        if self.status == "closed" and len(self.corrective_action) < 5:
            raise ValueError("Registre a ação corretiva antes de encerrar o incidente")
        return self


class InstitutionalDocumentPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=3, max_length=160)
    document_type: Literal["protocol", "policy", "form", "procedure", "other"]
    version: str = Field(min_length=1, max_length=24)
    content: str = Field(min_length=1, max_length=10000)
    valid_until: date | None = None

    @field_validator("title", "version", "content")
    @classmethod
    def trim_document_text(cls, value: str) -> str:
        return value.strip()


class InstitutionalDocumentStatusPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["in_review", "approved", "archived"]


class EmergencyClinicalPriorityPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    clinical_priority: Literal["unassigned", "routine", "priority", "urgent"]
    reason: str = Field(min_length=3, max_length=300)

    @field_validator("reason")
    @classmethod
    def trim_priority_reason(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 3:
            raise ValueError("Informe o motivo clínico da classificação")
        return value


class MedicationAdministrationPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    dispensation_id: str = Field(min_length=1, max_length=36)
    patient_reference: str = Field(min_length=1, max_length=36)
    dose: str = Field(pattern=r"^\d{1,9}(?:[.,]\d{1,3})?$", max_length=32)
    status: Literal["administered", "refused", "held"]
    reason: str = Field(default="", max_length=500)

    @field_validator("reason")
    @classmethod
    def trim_reason(cls, value: str) -> str:
        return value.strip()


class ScheduledMedicationAdministrationItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    prescription_reference: str = Field(min_length=1, max_length=36)
    status: Literal["administered", "unavailable", "refused", "held"]
    reason: str = Field(default="", max_length=500)

    @field_validator("reason")
    @classmethod
    def trim_reason(cls, value: str) -> str:
        return value.strip()

    @model_validator(mode="after")
    def validate_reason(self) -> "ScheduledMedicationAdministrationItem":
        if self.status != "administered" and len(self.reason) < 3:
            raise ValueError("Informe o motivo da dose não administrada")
        if self.status == "administered" and self.reason:
            raise ValueError("Motivo de exceção somente para dose não administrada")
        return self


class ScheduledMedicationAdministrationBatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    scheduled_date: date
    scheduled_time: str = Field(pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")
    items: list[ScheduledMedicationAdministrationItem] = Field(min_length=1, max_length=500)

    @model_validator(mode="after")
    def validate_items(self) -> "ScheduledMedicationAdministrationBatch":
        references = [item.prescription_reference for item in self.items]
        if len(set(references)) != len(references):
            raise ValueError("Não repita prescrições no mesmo registro")
        return self


class PhysicianProfilePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=2, max_length=120)
    crm: str = Field(min_length=3, max_length=24)
    crm_state: str = Field(pattern=r"^[A-Za-z]{2}$")

    @field_validator("name", "crm")
    @classmethod
    def trim_profile_fields(cls, value: str) -> str:
        return value.strip()

    @field_validator("crm_state")
    @classmethod
    def normalize_crm_state(cls, value: str) -> str:
        return value.upper()

    @model_validator(mode="after")
    def validate_trimmed_identity(self) -> "PhysicianProfilePayload":
        if len(self.name) < 2:
            raise ValueError("Informe o nome profissional")
        if len(self.crm) < 3:
            raise ValueError("Informe o CRM")
        return self


class PhysicianPrescriptionPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    patient_reference: str = Field(min_length=1, max_length=36)
    medication_name: str = Field(min_length=2, max_length=160)
    active_ingredient: str = Field(default="", max_length=160)
    presentation: str = Field(default="", max_length=160)
    dose: str = Field(min_length=1, max_length=120)
    route: str = Field(min_length=2, max_length=80)
    frequency: str = Field(min_length=2, max_length=160)
    administration_times: list[str] = Field(default_factory=list, max_length=24)
    duration: str = Field(min_length=1, max_length=120)
    quantity: str = Field(min_length=1, max_length=40)
    unit: str = Field(min_length=1, max_length=40)
    instructions: str = Field(default="", max_length=1000)
    is_controlled: bool = False

    @field_validator(
        "medication_name",
        "active_ingredient",
        "presentation",
        "dose",
        "route",
        "frequency",
        "duration",
        "quantity",
        "unit",
        "instructions",
    )
    @classmethod
    def trim_prescription_fields(cls, value: str) -> str:
        return value.strip()

    @field_validator("administration_times")
    @classmethod
    def validate_administration_times(cls, values: list[str]) -> list[str]:
        if any(not isinstance(value, str) or re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", value) is None for value in values):
            raise ValueError("Informe os horários no formato HH:MM")
        if len(set(values)) != len(values):
            raise ValueError("Não repita horários de administração")
        return sorted(values)

    @model_validator(mode="after")
    def validate_trimmed_required_fields(self) -> "PhysicianPrescriptionPayload":
        if len(self.medication_name) < 2:
            raise ValueError("Informe o medicamento")
        if len(self.route) < 2 or len(self.frequency) < 2:
            raise ValueError("Informe a via e a frequência")
        if any(not getattr(self, field).strip() for field in ("dose", "duration", "quantity", "unit")):
            raise ValueError("Complete dose, duração, quantidade e unidade")
        return self


class PhysicianPrescriptionStatusPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["fulfilled", "cancelled"]


class InternalPrescriptionResolutionPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    prescription_reference: str = Field(min_length=1, max_length=36)
    patient_reference: str = Field(min_length=1, max_length=36)
    fulfill: bool = False


def get_nursing_db():
    yield from database_session("nursing")


BED_ACCESS = require_demo_role("management", "nursing", "reception", "hygiene", "maintenance")
BED_READ_ACCESS = require_demo_role(
    "management", "nursing", "reception", "hygiene", "maintenance", "patients"
)
BED_MANAGEMENT = require_demo_role("management")


def _active_assignment_for_bed(db: Session, bed_id: str) -> BedAssignment | None:
    return db.scalar(
        select(BedAssignment).where(
            BedAssignment.bed_id == bed_id,
            BedAssignment.released_at.is_(None),
        )
    )


def _active_assignment_for_patient(db: Session, patient_reference: str) -> BedAssignment | None:
    return db.scalar(
        select(BedAssignment).where(
            BedAssignment.patient_reference == patient_reference,
            BedAssignment.released_at.is_(None),
        )
    )


def _legacy_patient_at_bed(
    db: Session,
    bed: HospitalBed,
    exclude_patient_reference: str | None = None,
) -> str | None:
    filters = [
            Patient.active.is_(True),
            Patient.room == bed.room,
            Patient.bed == bed.label,
            ~exists().where(
                BedAssignment.patient_reference == Patient.reference,
                BedAssignment.released_at.is_(None),
            ),
    ]
    if exclude_patient_reference:
        filters.append(Patient.reference != exclude_patient_reference)
    return db.scalar(select(Patient.reference).where(*filters).limit(1))


def _available_hospital_bed(
    db: Session,
    bed_id: str,
    exclude_patient_reference: str | None = None,
) -> tuple[HospitalBed, HospitalUnit]:
    bed = db.scalar(
        select(HospitalBed)
        .where(HospitalBed.id == bed_id)
        .with_for_update()
    )
    if bed is None or not bed.active:
        raise HTTPException(status_code=404, detail="Leito não encontrado ou inativo")
    unit = db.get(HospitalUnit, bed.unit_id)
    if unit is None or not unit.active:
        raise HTTPException(status_code=409, detail="A unidade deste leito está inativa")
    if bed.status != "available":
        raise HTTPException(status_code=409, detail="O leito não está liberado para internação")
    if _active_assignment_for_bed(db, bed.id):
        raise HTTPException(status_code=409, detail="O leito já está ocupado")
    if _legacy_patient_at_bed(db, bed, exclude_patient_reference):
        raise HTTPException(
            status_code=409,
            detail="Há um paciente legado neste quarto/leito; reconcilie o cadastro antes de reutilizá-lo",
        )
    return bed, unit


def _assign_patient_to_bed(
    db: Session,
    patient: Patient,
    bed: HospitalBed,
    principal: DemoPrincipal,
    occurred_at: datetime,
) -> None:
    existing = _active_assignment_for_patient(db, patient.reference)
    if existing:
        existing.released_at = occurred_at
        existing.released_by = principal.actor_name
    assignment = BedAssignment(
        bed_id=bed.id,
        patient_reference=patient.reference,
        assigned_at=occurred_at,
        assigned_by=principal.actor_name,
    )
    db.add(assignment)
    patient.room = bed.room
    patient.bed = bed.label
    patient.updated_at = occurred_at
    patient.updated_by = principal.actor_name


def _release_patient_bed(
    db: Session,
    patient: Patient,
    principal: DemoPrincipal,
    occurred_at: datetime,
) -> None:
    assignment = _active_assignment_for_patient(db, patient.reference)
    if assignment:
        assignment.released_at = occurred_at
        assignment.released_by = principal.actor_name


def _bed_capacity(db: Session) -> dict[str, int | float | None]:
    beds = db.scalars(
        select(HospitalBed).where(HospitalBed.active.is_(True))
    ).all()
    operational = sum(bed.status == "available" for bed in beds)
    occupied = db.scalar(
        select(func.count(BedAssignment.id))
        .join(Patient, Patient.reference == BedAssignment.patient_reference)
        .join(HospitalBed, HospitalBed.id == BedAssignment.bed_id)
        .where(
            BedAssignment.released_at.is_(None),
            Patient.active.is_(True),
            HospitalBed.active.is_(True),
        )
    ) or 0
    legacy_unmapped = db.scalar(
        select(func.count(Patient.reference)).where(
            Patient.active.is_(True),
            Patient.room != "",
            Patient.bed != "",
            ~exists().where(
                BedAssignment.patient_reference == Patient.reference,
                BedAssignment.released_at.is_(None),
            ),
        )
    ) or 0
    return {
        "total_beds": len(beds),
        "operational_beds": operational,
        "occupied_beds": occupied,
        "available_beds": max(operational - occupied, 0),
        "unreconciled_legacy_patients": legacy_unmapped,
        "occupancy_percent": round(occupied * 100 / operational, 1)
        if operational > 0 and legacy_unmapped == 0
        else None,
    }


def _serialize_hospital_bed(
    bed: HospitalBed,
    unit: HospitalUnit,
    assignment: BedAssignment | None,
) -> dict[str, object]:
    return {
        "id": bed.id,
        "unit_id": unit.id,
        "unit_name": unit.name,
        "room": bed.room,
        "label": bed.label,
        "status": bed.status,
        "isolation_capable": bed.isolation_capable,
        "notes": bed.notes,
        "active": bed.active,
        "occupied": assignment is not None,
        "patient_reference": assignment.patient_reference if assignment else None,
    }


@asynccontextmanager
async def lifespan(_: FastAPI):
    verify_database_migrated("nursing")
    async with audit_outbox_lifespan("nursing"):
        yield


app = FastAPI(
    title="SCPO Connect · Serviço de Enfermagem",
    version="1.0.0",
    description="API para cadastro de pacientes e registros de sinais vitais.",
    lifespan=lifespan,
)


@app.get("/api/v1/nursing/beds")
def list_hospital_beds(
    principal: Annotated[DemoPrincipal, Depends(BED_READ_ACCESS)],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, object]:
    rows = db.execute(
        select(HospitalBed, HospitalUnit, BedAssignment)
        .join(HospitalUnit, HospitalUnit.id == HospitalBed.unit_id)
        .outerjoin(
            BedAssignment,
            (BedAssignment.bed_id == HospitalBed.id)
            & BedAssignment.released_at.is_(None),
        )
        .where(HospitalBed.active.is_(True), HospitalUnit.active.is_(True))
        .order_by(HospitalUnit.name, HospitalBed.room, HospitalBed.label)
    ).all()
    units = db.scalars(
        select(HospitalUnit).where(HospitalUnit.active.is_(True)).order_by(HospitalUnit.name)
    ).all()
    emit_audit_event(principal, "management", "hospital_bed_capacity_read", "hospital_beds")
    return {
        "units": [{"id": unit.id, "name": unit.name} for unit in units],
        "beds": [
            _serialize_hospital_bed(bed, unit, assignment)
            for bed, unit, assignment in rows
        ],
        "capacity": _bed_capacity(db),
    }


@app.post("/api/v1/management/units", status_code=201)
def create_hospital_unit(
    payload: HospitalUnitPayload,
    principal: Annotated[DemoPrincipal, Depends(BED_MANAGEMENT)],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, object]:
    unit = HospitalUnit(
        id=str(uuid.uuid4()),
        name=payload.name,
        active=True,
        created_at=datetime.now(UTC),
        created_by=principal.actor_name,
    )
    db.add(unit)
    emit_audit_event(
        principal, "management", "hospital_unit_created", unit.id, db=db
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Já existe uma unidade com este nome") from exc
    db.refresh(unit)
    return {"id": unit.id, "name": unit.name, "active": unit.active}


@app.post("/api/v1/management/beds", status_code=201)
def create_hospital_bed(
    payload: HospitalBedPayload,
    principal: Annotated[DemoPrincipal, Depends(BED_MANAGEMENT)],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, object]:
    unit = db.get(HospitalUnit, payload.unit_id)
    if unit is None or not unit.active:
        raise HTTPException(status_code=404, detail="Unidade não encontrada ou inativa")
    bed = HospitalBed(
        id=str(uuid.uuid4()),
        unit_id=unit.id,
        room=payload.room,
        label=payload.label,
        status="available",
        isolation_capable=payload.isolation_capable,
        notes=payload.notes,
        active=True,
        created_at=datetime.now(UTC),
        created_by=principal.actor_name,
    )
    db.add(bed)
    emit_audit_event(
        principal, "management", "hospital_bed_created", bed.id, db=db
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Este quarto/leito já está cadastrado nesta unidade") from exc
    db.refresh(bed)
    return _serialize_hospital_bed(bed, unit, None)


@app.patch("/api/v1/management/beds/{bed_id}/status")
def update_hospital_bed_status(
    bed_id: str,
    payload: HospitalBedStatusPayload,
    principal: Annotated[DemoPrincipal, Depends(BED_ACCESS)],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, object]:
    bed = db.scalar(
        select(HospitalBed)
        .where(HospitalBed.id == bed_id)
        .with_for_update()
    )
    if bed is None or not bed.active:
        raise HTTPException(status_code=404, detail="Leito não encontrado ou inativo")
    if _active_assignment_for_bed(db, bed.id):
        raise HTTPException(status_code=409, detail="Não é possível alterar a situação de um leito ocupado")
    modules = set(principal.modules)
    if payload.status == "cleaning" and not (principal.is_superuser or "management" in modules):
        raise HTTPException(
            status_code=403,
            detail="A Higienização deve iniciar a limpeza por uma solicitação vinculada ao leito",
        )
    if payload.status == "maintenance" and not (principal.is_superuser or {"management", "maintenance"} & modules):
        raise HTTPException(status_code=403, detail="Apenas Manutenção ou Gestão pode bloquear leito para manutenção")
    if payload.status == "blocked" and not (principal.is_superuser or "management" in modules):
        raise HTTPException(status_code=403, detail="Apenas Gestão pode bloquear este leito")
    if payload.status == "available" and not (principal.is_superuser or {"management", "maintenance"} & modules):
        raise HTTPException(status_code=403, detail="Apenas Manutenção ou Gestão pode liberar este leito")
    if payload.status == "available" and bed.hygiene_request_id:
        raise HTTPException(
            status_code=409,
            detail="Conclua a solicitação de higienização vinculada antes de liberar este leito",
        )
    bed.status = payload.status
    unit = db.get(HospitalUnit, bed.unit_id)
    if unit is None:
        raise HTTPException(status_code=409, detail="Unidade do leito não encontrada")
    emit_audit_event(
        principal, "management", "hospital_bed_status_updated", bed.id, db=db
    )
    db.commit()
    return _serialize_hospital_bed(bed, unit, None)


@app.post("/internal/v1/hospital-beds/{bed_id}/cleaning")
def update_internal_hospital_bed_cleaning(
    bed_id: str,
    payload: InternalHospitalBedCleaningPayload,
    db: Annotated[Session, Depends(get_nursing_db)],
    _: Annotated[None, Depends(require_service_token)],
) -> dict[str, object]:
    bed = db.scalar(
        select(HospitalBed)
        .where(HospitalBed.id == bed_id)
        .with_for_update()
    )
    if bed is None or not bed.active:
        raise HTTPException(status_code=404, detail="Leito não encontrado ou inativo")
    unit = db.get(HospitalUnit, bed.unit_id)
    if unit is None:
        raise HTTPException(status_code=409, detail="Unidade do leito não encontrada")
    if _active_assignment_for_bed(db, bed.id):
        raise HTTPException(status_code=409, detail="Não é possível alterar um leito ocupado")
    if payload.action == "start" and _legacy_patient_at_bed(db, bed):
        raise HTTPException(
            status_code=409,
            detail="Há um paciente legado neste quarto/leito; reconcilie o cadastro antes de iniciar a higienização",
        )

    expected_request_id = payload.request_id
    changed = False
    if payload.action == "start":
        if bed.status == "cleaning" and bed.hygiene_request_id == expected_request_id:
            return _serialize_hospital_bed(bed, unit, None)
        if bed.status != "available" or bed.hygiene_request_id is not None:
            raise HTTPException(status_code=409, detail="O leito não está disponível para iniciar a higienização")
        bed.status = "cleaning"
        bed.hygiene_request_id = expected_request_id
        action = "hospital_bed_cleaning_started"
        changed = True
    elif payload.action == "release":
        if bed.status == "available" and bed.hygiene_request_id is None:
            return _serialize_hospital_bed(bed, unit, None)
        if bed.status != "cleaning" or bed.hygiene_request_id != expected_request_id:
            raise HTTPException(status_code=409, detail="O leito não está vinculado a esta solicitação de higienização")
        bed.status = "available"
        bed.hygiene_request_id = None
        action = "hospital_bed_cleaning_released"
        changed = True
    else:
        if bed.status == "available" and bed.hygiene_request_id is None:
            return _serialize_hospital_bed(bed, unit, None)
        if bed.status != "cleaning" or bed.hygiene_request_id != expected_request_id:
            raise HTTPException(status_code=409, detail="Não é possível reverter uma solicitação que não controla este leito")
        bed.status = "available"
        bed.hygiene_request_id = None
        action = "hospital_bed_cleaning_rolled_back"
        changed = True

    if changed:
        principal = DemoPrincipal(
            payload.actor_id,
            payload.actor_id,
            payload.actor_name,
            "hygiene",
            ["hygiene"],
            {"hygiene": ["consultar", "alterar"]},
        )
        emit_audit_event(principal, "management", action, bed.id, db=db)
    db.commit()
    return _serialize_hospital_bed(bed, unit, None)


@app.post("/api/v1/management/patients/{patient_reference}/bed-reconciliation")
def reconcile_legacy_patient_bed(
    patient_reference: str,
    payload: PatientBedReconciliationPayload,
    principal: Annotated[DemoPrincipal, Depends(BED_MANAGEMENT)],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, object]:
    patient = db.get(Patient, patient_reference)
    if patient is None or not patient.active:
        raise HTTPException(status_code=404, detail="Paciente ativo não encontrado")
    if _active_assignment_for_patient(db, patient.reference):
        raise HTTPException(status_code=409, detail="Este paciente já está vinculado a um leito físico")
    bed, unit = _available_hospital_bed(
        db, payload.bed_id, exclude_patient_reference=patient.reference
    )
    if patient.room != bed.room or patient.bed != bed.label:
        raise HTTPException(
            status_code=409,
            detail="Quarto/leito do cadastro legado não corresponde ao leito físico; revise o cadastro antes de reconciliar",
        )
    now = datetime.now(UTC)
    _assign_patient_to_bed(db, patient, bed, principal, now)
    emit_audit_event(
        principal, "management", "legacy_patient_bed_reconciled",
        patient.reference, db=db,
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="O leito foi ocupado por outra operação; atualize o mapa") from exc
    return {
        "patient": serialize_patient(patient, principal=principal),
        "bed": _serialize_hospital_bed(bed, unit, _active_assignment_for_bed(db, bed.id)),
    }
NURSING_ROLE = require_demo_role("nursing")
NURSING_VITALS_READ = require_demo_role("nursing", "physician", "management", "admin", "oversight")
NURSING_TRIAGE_READ = require_demo_role("nursing", "management", "admin", "oversight")
PHYSICIAN_TRIAGE_READ = require_demo_role("physician", "management", "admin", "oversight")
NUTRITION_ROLE = require_demo_role("nutrition")
NUTRITION_REPORT_ACCESS = require_demo_role("nutrition", "management", "admin", "oversight")
VALUE_FIELDS = {
    "saturation",
    "pressure",
    "heartRate",
    "respiratoryRate",
    "temperature",
    "glucose",
    "venousSite",
    "venousCondition",
    "venousNote",
    "urine",
    "bowel",
    "bowelTube",
    "pain",
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
NUMERIC_FIELDS = {"saturation", "heartRate", "respiratoryRate", "temperature", "glucose", "pain"}
VITAL_FIELDS = {"saturation", "pressure", "heartRate", "respiratoryRate", "temperature", "glucose"}
TRIAGE_VITAL_FIELDS = {"saturation", "pressure", "heartRate", "respiratoryRate", "temperature", "glucose"}


def validate_vital_values(values: dict[str, str], allowed_fields: set[str]) -> dict[str, str]:
    unexpected = values.keys() - allowed_fields
    if unexpected:
        raise ValueError("Campo não permitido")
    for field, value in values.items():
        if len(value) > (2000 if field == "examResult" else 1000):
            raise ValueError("Campo excede o limite permitido")
        if field in NUMERIC_FIELDS and value and not re.fullmatch(r"\d{1,6}(?:[.,]\d{1,4})?", value):
            raise ValueError("Informe um valor numérico válido")
        if field == "pressure" and value and not re.fullmatch(r"\d{1,4}/\d{1,4}", value):
            raise ValueError("Formato inválido para pressão arterial")
        allowed_choices = {
            "venousCondition": {"venoso periférico", "jugular", "central"},
            "urine": {"Sim", "Não"},
            "bowel": {"Sim", "Não", "registrada", "não se aplica"},
            "bowelTube": {"Sim", "Não"},
        }.get(field)
        if value and allowed_choices is not None and value not in allowed_choices:
            raise ValueError("Opção inválida para o campo selecionado")
    if len(values.get("notes", "")) > 1000:
        raise ValueError("Observações excedem o limite permitido")
    return values


class PatientPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=2, max_length=120)
    bed_id: str | None = Field(default=None, max_length=36)
    mother_name: str = Field(default="", max_length=120)
    health_plan: str = Field(default="", max_length=120)
    same_number: str = Field(default="", max_length=40)
    room: str = Field(default="", max_length=20)
    bed: str = Field(default="", max_length=20)
    cpf: str = Field(default="", max_length=14)
    sus_card: str = Field(default="", max_length=20)
    allergies: str = Field(default="", max_length=1000)
    allergies_status: Literal["unknown", "none_known", "known"] = "unknown"
    treatment_track: Literal["clinical", "psychiatric", "combined", "unclassified"] | None = None
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
    responsible_status: Literal["unknown", "not_applicable", "provided"] = "unknown"
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
    elopement_risk: bool = True

    @field_validator("name")
    @classmethod
    def trim_required_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Este campo é obrigatório")
        return value

    @field_validator("room", "bed")
    @classmethod
    def trim_optional_location(cls, value: str) -> str:
        return value.strip()

    @model_validator(mode="after")
    def validate_location_pair(self) -> "PatientPayload":
        if bool(self.room.strip()) != bool(self.bed.strip()):
            raise ValueError("Informe quarto e leito juntos ou deixe ambos sem acomodação")
        return self

    @field_validator("photo_data")
    @classmethod
    def validate_photo(cls, value: str) -> str:
        if value and not re.fullmatch(r"data:image/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}", value):
            raise ValueError("A foto deve ser uma imagem JPEG, PNG ou WebP válida")
        return value

    @field_validator("cpf")
    @classmethod
    def validate_cpf(cls, value: str) -> str:
        return validate_cpf_number(value)

    @field_validator("allergies")
    @classmethod
    def trim_allergies(cls, value: str) -> str:
        return value.strip()

    @model_validator(mode="after")
    def validate_allergy_status(self) -> "PatientPayload":
        if self.allergies_status == "known" and not self.allergies:
            raise ValueError("Descreva a alergia conhecida")
        if self.allergies_status != "known" and self.allergies:
            raise ValueError("Descreva alergias somente quando o status for 'known'")
        return self


class ElopementRiskPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    at_risk: bool


class ActivityProcedureRow(BaseModel):
    model_config = ConfigDict(extra="forbid")
    professional_activity: str = Field(default="", max_length=120)
    procedure: str = Field(default="", max_length=120)

    @field_validator("professional_activity", "procedure")
    @classmethod
    def trim_row_text(cls, value: str) -> str:
        return value.strip()


class OutpatientEncounterPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    patient_reference: str | None = Field(default=None, max_length=36)
    new_patient: PatientPayload | None = None
    encounter_type: Literal[
        "outpatient",
        "urgent_emergency",
        "first_consultation",
        "return",
        "emergency_referral",
        "reference_consultation",
    ]
    queue_type: Literal["common", "priority"] = "common"
    same_number: str = Field(default="", max_length=40)
    physician_name: str = Field(default="", max_length=120)
    examination: str = Field(default="", max_length=1000)
    activity_rows: list[ActivityProcedureRow] = Field(default_factory=list, max_length=20)
    group_name: str = Field(default="", max_length=120)
    programs: list[Literal["prenatal", "puericulture", "cervical_cancer"]] = Field(
        default_factory=list, max_length=3
    )
    diagnostic_hypothesis: str = Field(default="", max_length=2000)
    antibiotic_prescription: str = Field(default="", max_length=2000)
    referral: Literal[
        "discharge",
        "return_same_unit",
        "exams",
        "specialty",
        "hospital",
        "emergency",
    ]

    @field_validator("same_number", "physician_name", "examination", "group_name", "diagnostic_hypothesis", "antibiotic_prescription")
    @classmethod
    def trim_optional_fields(cls, value: str) -> str:
        return value.strip()

    @model_validator(mode="after")
    def validate_patient_source(self) -> "OutpatientEncounterPayload":
        if bool(self.patient_reference) == bool(self.new_patient):
            raise ValueError("Selecione um paciente cadastrado ou preencha um novo cadastro")
        if self.new_patient and (self.new_patient.room or self.new_patient.bed):
            raise ValueError("O cadastro ambulatorial deve iniciar sem quarto e leito")
        if len(set(self.programs)) != len(self.programs):
            raise ValueError("Não repita programas no mesmo atendimento")
        return self


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
    allergies_status: Literal["unknown", "none_known", "known"] | None = None
    restrictions: str = Field(default="", max_length=500)
    appetite: Literal["", "normal", "reduced", "poor", "increased"] = ""
    hydration: Literal["", "adequate", "low", "assisted"] = ""
    notes: str = Field(default="", max_length=3000)
    fasting_at: datetime | None = None
    fasting_reason: str = Field(default="", max_length=500)

    @field_validator("allergies")
    @classmethod
    def trim_allergies(cls, value: str) -> str:
        return value.strip()

    @model_validator(mode="after")
    def validate_allergy_status(self) -> "NutritionPayload":
        if self.allergies_status == "known" and not self.allergies:
            raise ValueError("Descreva as alergias conhecidas")
        if self.allergies_status in {"unknown", "none_known"} and self.allergies:
            raise ValueError("Descreva alergias somente quando o status for 'known'")
        return self

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


PATIENT_MODULES = ("patients", "nursing", "pharmacy", "reception", "therapy", "nutrition", "social", "xray", "physician", "maintenance", "psychology", "management")


async def authorize_patient_module(request: Request) -> DemoPrincipal:
    from .common import authenticated_principal

    principal = await authenticated_principal(request)
    action = {"GET": "consultar", "HEAD": "consultar", "POST": "criar", "PUT": "alterar", "PATCH": "alterar", "DELETE": "excluir"}.get(request.method.upper(), "consultar")
    report_access = action == "consultar" and any(
        module in principal.modules and action in principal.permissions.get(module, [])
        for module in ("admin", "oversight")
    )
    if report_access or any(module in principal.modules and action in principal.permissions.get(module, []) for module in PATIENT_MODULES):
        return principal
    raise HTTPException(status_code=403, detail="Acesso ao cadastro de pacientes não autorizado")


PATIENT_ACCESS = Depends(authorize_patient_module)
PATIENT_DELETE_ACCESS = Depends(require_demo_role_or_superuser("admin"))
OUTPATIENT_ARRIVAL_REASON = "Ficha ambulatorial registrada"
PATIENT_HISTORY_ACCESS = Depends(
    require_demo_role_or_superuser(
        "patients", "nursing", "physician", "psychology", "management", "admin"
    )
)
CLINICAL_HISTORY_MODULES = ("nursing", "physician", "psychology", "admin")
CLINICAL_HISTORY_ACCESS = Depends(
    require_demo_role_or_superuser(*CLINICAL_HISTORY_MODULES)
)
CLINICAL_RISK_ACCESS = Depends(require_demo_role("nursing", "nutrition", "pharmacy", "physician", "management"))
PHYSICIAN_ACCESS = require_demo_role("physician", "management")
PHYSICIAN_PROFILE_READ_ACCESS = require_demo_role("physician", "management", "admin")
PRESCRIPTION_READ_ACCESS = require_demo_role("physician", "pharmacy", "nursing", "management", "admin", "oversight")


def record_patient_allergy_change(
    db: Session,
    principal: DemoPrincipal,
    patient: Patient,
    next_status: str,
    next_details: str,
    reason: str,
    previous_status: str | None = None,
    previous_details: str | None = None,
) -> None:
    old_status = patient.allergies_status if previous_status is None else previous_status
    old_details = patient.allergies if previous_details is None else previous_details
    if old_status == next_status and old_details == next_details:
        return
    db.add(
        PatientAllergyHistory(
            patient_reference=patient.reference,
            previous_status=old_status,
            previous_details=old_details,
            new_status=next_status,
            new_details=next_details,
            reason=reason,
            actor_id=principal.user_id,
            actor_name=principal.actor_name,
            recorded_at=datetime.now(UTC),
        )
    )


class VitalPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    patient_reference: str = Field(min_length=1, max_length=36)
    values: dict[str, str] = Field(default_factory=dict)
    glucose_unit: Literal["mg/dL", "mmol/L"] = "mg/dL"
    not_applicable: list[str] = Field(default_factory=list)
    measured_at: datetime | None = None

    @field_validator("measured_at")
    @classmethod
    def validate_measured_at(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.tzinfo is None:
            raise ValueError("O horário da aferição deve incluir fuso horário")
        return value

    @field_validator("values")
    @classmethod
    def validate_values(cls, values: dict[str, str]) -> dict[str, str]:
        return validate_vital_values(values, VALUE_FIELDS)

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
    recorded_at = datetime.now(UTC)
    measured_at = payload.measured_at or recorded_at
    if measured_at > recorded_at:
        raise HTTPException(status_code=422, detail="O horário da aferição não pode estar no futuro")
    record = VitalRecord(
        patient_reference=payload.patient_reference,
        actor_id=principal.user_id,
        actor_name=principal.actor_name,
        values=payload.values,
        glucose_unit=payload.glucose_unit,
        not_applicable=payload.not_applicable,
        measured_at=measured_at,
        recorded_at=recorded_at,
    )
    db.add(record)
    emit_audit_event(
        principal, "nursing", "vitals_recorded", payload.patient_reference, db=db
    )
    db.commit()
    db.refresh(record)
    return serialize_record(record)


@app.get("/api/v1/nursing/patients")
def list_patients(
    principal: Annotated[DemoPrincipal, PATIENT_ACCESS],
    db: Annotated[Session, Depends(get_nursing_db)],
    full_profile: bool = False,
    include_inactive: bool = False,
    include_archived: bool = False,
    limit: Annotated[int | None, Query(ge=1, le=200)] = None,
    offset: Annotated[int, Query(ge=0)] = 0,
    search: Annotated[str | None, Query(max_length=120)] = None,
    room: Annotated[str | None, Query(max_length=20)] = None,
    bed: Annotated[str | None, Query(max_length=20)] = None,
    inpatient: bool | None = None,
    treatment_track: Literal["clinical", "psychiatric", "combined", "unclassified"] | None = None,
    status: Literal["all", "active", "inactive"] | None = None,
    sort: Literal["location", "name"] = "location",
) -> dict[str, object]:
    if full_profile and not can_view_full_patient_profile(principal):
        raise HTTPException(status_code=403, detail="Acesso aos dados cadastrais completos não autorizado")
    query = select(Patient)
    if not include_archived:
        query = query.where(Patient.deleted_at.is_(None))
    if status == "active":
        query = query.where(Patient.active.is_(True))
    elif status == "inactive":
        query = query.where(Patient.active.is_(False))
    elif status != "all" and not include_inactive:
        query = query.where(Patient.active.is_(True))
    if inpatient is True:
        query = query.where(func.trim(Patient.room) != "", func.trim(Patient.bed) != "")
    elif inpatient is False:
        query = query.where(
            or_(func.trim(Patient.room) == "", func.trim(Patient.bed) == "")
        )

    if room:
        query = query.where(Patient.room == room)
    if bed:
        query = query.where(Patient.bed == bed)
    if treatment_track:
        query = query.where(Patient.treatment_track == treatment_track)

    query_terms = (search or "").strip().casefold().split()
    searchable_fields = [Patient.name, Patient.room, Patient.bed]
    if full_profile:
        searchable_fields.extend(
            [Patient.responsible_name, Patient.cpf, Patient.sus_card]
        )
    for term in query_terms:
        matching_fields = [
            field.ilike(f"%{term}%")
            for field in searchable_fields
        ]
        digits = re.sub(r"\D", "", term)
        if digits and full_profile:
            normalized_cpf = func.replace(func.replace(Patient.cpf, ".", ""), "-", "")
            normalized_sus_card = func.replace(
                func.replace(Patient.sus_card, ".", ""), "-", ""
            )
            matching_fields.extend(
                [
                    normalized_cpf.contains(digits),
                    normalized_sus_card.contains(digits),
                ]
            )
        query = query.where(or_(*matching_fields))

    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    if sort == "name":
        query = query.order_by(func.lower(Patient.name), Patient.reference)
    else:
        query = query.order_by(
            func.lower(Patient.room),
            func.lower(Patient.bed),
            func.lower(Patient.name),
            Patient.reference,
        )
    if limit is not None:
        query = query.offset(offset).limit(limit)
    patients = db.scalars(query).all()

    room_facet_query = select(Patient.room)
    if not include_archived:
        room_facet_query = room_facet_query.where(Patient.deleted_at.is_(None))
    if status == "active" or (status is None and not include_inactive):
        room_facet_query = room_facet_query.where(Patient.active.is_(True))
    elif status == "inactive":
        room_facet_query = room_facet_query.where(Patient.active.is_(False))
    rooms = sorted(
        {
            patient_room
            for patient_room in db.scalars(room_facet_query.distinct()).all()
            if patient_room.strip()
        }
    )

    bed_facet_query = select(Patient.room, Patient.bed)
    if not include_archived:
        bed_facet_query = bed_facet_query.where(Patient.deleted_at.is_(None))
    if status == "active" or (status is None and not include_inactive):
        bed_facet_query = bed_facet_query.where(Patient.active.is_(True))
    elif status == "inactive":
        bed_facet_query = bed_facet_query.where(Patient.active.is_(False))
    if room:
        bed_facet_query = bed_facet_query.where(Patient.room == room)
    facets = db.execute(bed_facet_query.distinct()).all()
    beds = sorted({patient_bed for patient_room, patient_bed in facets if patient_bed.strip()})
    count_query = select(Patient.active, func.count()).where(Patient.deleted_at.is_(None)).group_by(Patient.active)
    patient_counts = {active: count for active, count in db.execute(count_query).all()}
    active_assigned_count = db.scalar(
        select(func.count())
        .select_from(Patient)
        .where(
            Patient.active.is_(True),
            Patient.deleted_at.is_(None),
            Patient.room != "",
            Patient.bed != "",
        )
    ) or 0
    emit_audit_event(principal, "patients", "patient_list_read", "patient_registry")
    return {
        "patients": [
            serialize_patient(patient, principal=principal, full_profile=full_profile)
            for patient in patients
        ],
        "total": total,
        "offset": offset,
        "limit": limit,
        "rooms": rooms,
        "beds": beds,
        "active_count": patient_counts.get(True, 0),
        "inactive_count": patient_counts.get(False, 0),
        "active_assigned_count": active_assigned_count,
        "active_unassigned_count": max(patient_counts.get(True, 0) - active_assigned_count, 0),
    }


def _active_round_patients(db: Session) -> list[Patient]:
    return db.scalars(
        select(Patient)
        .where(
            Patient.active.is_(True),
            Patient.deleted_at.is_(None),
            Patient.room != "",
            Patient.bed != "",
        )
        .order_by(Patient.room, Patient.bed, Patient.name)
    ).all()


def serialize_nursing_hourly_round(db: Session, round_record: NursingHourlyRound) -> dict[str, object]:
    patients = db.scalars(
        select(NursingHourlyRoundPatient)
        .where(NursingHourlyRoundPatient.round_id == round_record.id)
        .order_by(
            NursingHourlyRoundPatient.room,
            NursingHourlyRoundPatient.bed,
            NursingHourlyRoundPatient.patient_name,
        )
    ).all()
    return {
        "id": round_record.id,
        "status": round_record.status,
        "started_by_id": round_record.started_by_id,
        "started_by_name": round_record.started_by_name,
        "started_at": round_record.started_at.isoformat(),
        "completed_by_id": round_record.completed_by_id,
        "completed_by_name": round_record.completed_by_name,
        "completed_at": round_record.completed_at.isoformat() if round_record.completed_at else None,
        "patient_count": len(patients),
        "checked_count": sum(item.status == "checked" for item in patients),
        "exception_count": sum(item.status == "exception" for item in patients),
        "patients": [
            {
                "patient_reference": item.patient_reference,
                "patient_name": item.patient_name,
                "room": item.room,
                "bed": item.bed,
                "status": item.status,
                "exception_type": item.exception_type,
                "note": item.note,
                "elopement_risk": item.elopement_risk,
                "checked_by_id": item.checked_by_id,
                "checked_by_name": item.checked_by_name,
                "checked_at": item.checked_at.isoformat() if item.checked_at else None,
            }
            for item in patients
        ],
    }


@app.get("/api/v1/nursing/hourly-rounds/current")
def get_current_nursing_hourly_round(
    principal: Annotated[DemoPrincipal, Depends(NURSING_ROLE)],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, object | None]:
    round_record = db.scalar(
        select(NursingHourlyRound).where(NursingHourlyRound.status == "open")
    )
    if round_record is None:
        return {"round": None}

    members = {
        item.patient_reference: item
        for item in db.scalars(
            select(NursingHourlyRoundPatient).where(
                NursingHourlyRoundPatient.round_id == round_record.id
            )
        ).all()
    }
    added_count = 0
    for patient in _active_round_patients(db):
        member = members.get(patient.reference)
        if member is None:
            member = NursingHourlyRoundPatient(
                round_id=round_record.id,
                patient_reference=patient.reference,
                patient_name=patient.name,
                room=patient.room,
                bed=patient.bed,
                elopement_risk=patient.elopement_risk,
                status="pending",
            )
            db.add(member)
            added_count += 1
        else:
            if member.status == "pending":
                member.patient_name = patient.name
                member.room = patient.room
                member.bed = patient.bed
            if member.elopement_risk != patient.elopement_risk:
                member.elopement_risk = patient.elopement_risk

    if added_count:
        emit_audit_event(
            principal,
            "nursing",
            "hourly_round_patients_added",
            round_record.id,
            db=db,
        )
    db.commit()
    db.refresh(round_record)
    return {"round": serialize_nursing_hourly_round(db, round_record)}


@app.get("/api/v1/nursing/hourly-rounds")
def list_nursing_hourly_rounds(
    principal: Annotated[DemoPrincipal, Depends(require_demo_role("nursing", "management", "admin", "oversight"))],
    db: Annotated[Session, Depends(get_nursing_db)],
    limit: Annotated[int, Query(ge=1, le=100)] = 10,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> dict[str, object]:
    query = select(NursingHourlyRound)
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    rounds = db.scalars(
        query.order_by(NursingHourlyRound.started_at.desc())
        .offset(offset)
        .limit(limit)
    ).all()
    emit_audit_event(principal, "nursing", "hourly_round_history_read", "nursing_rounds")
    return {"rounds": [serialize_nursing_hourly_round(db, item) for item in rounds], "total": total, "limit": limit, "offset": offset}


@app.post("/api/v1/nursing/hourly-rounds", status_code=201)
def start_nursing_hourly_round(
    principal: Annotated[DemoPrincipal, Depends(NURSING_ROLE)],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, object]:
    if db.scalar(
        select(NursingHourlyRound.id).where(NursingHourlyRound.status == "open")
    ):
        raise HTTPException(status_code=409, detail="Já existe uma ronda em andamento")
    patients = _active_round_patients(db)
    if not patients:
        raise HTTPException(
            status_code=409,
            detail="Não há pacientes ativos com quarto e leito para iniciar a ronda",
        )
    now = datetime.now(UTC)
    round_record = NursingHourlyRound(
        id=str(uuid.uuid4()),
        status="open",
        started_by_id=principal.user_id,
        started_by_name=principal.actor_name,
        started_at=now,
    )
    db.add(round_record)
    for patient in patients:
        db.add(
            NursingHourlyRoundPatient(
                round_id=round_record.id,
                patient_reference=patient.reference,
                patient_name=patient.name,
                room=patient.room,
                bed=patient.bed,
                elopement_risk=patient.elopement_risk,
                status="pending",
            )
        )
    emit_audit_event(
        principal,
        "nursing",
        "hourly_round_started",
        round_record.id,
        db=db,
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Já existe uma ronda em andamento") from exc
    db.refresh(round_record)
    return serialize_nursing_hourly_round(db, round_record)


@app.patch("/api/v1/nursing/hourly-rounds/{round_id}/patients/{patient_reference}")
def update_nursing_hourly_round_patient(
    round_id: str,
    patient_reference: str,
    payload: NursingHourlyRoundPatientPayload,
    principal: Annotated[DemoPrincipal, Depends(NURSING_ROLE)],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, object]:
    round_record = db.get(NursingHourlyRound, round_id)
    if round_record is None:
        raise HTTPException(status_code=404, detail="Ronda não encontrada")
    if round_record.status != "open":
        raise HTTPException(status_code=409, detail="Esta ronda já foi encerrada")
    member = db.scalar(
        select(NursingHourlyRoundPatient).where(
            NursingHourlyRoundPatient.round_id == round_id,
            NursingHourlyRoundPatient.patient_reference == patient_reference,
        )
    )
    if member is None:
        raise HTTPException(status_code=404, detail="Paciente não pertence a esta ronda")
    member.status = payload.status
    member.exception_type = payload.exception_type or ""
    member.note = payload.note
    member.checked_by_id = principal.user_id
    member.checked_by_name = principal.actor_name
    member.checked_at = datetime.now(UTC)
    emit_audit_event(
        principal,
        "nursing",
        "hourly_round_patient_updated",
        f"{round_id}:{patient_reference}",
        db=db,
    )
    db.commit()
    db.refresh(round_record)
    return serialize_nursing_hourly_round(db, round_record)


@app.post("/api/v1/nursing/hourly-rounds/{round_id}/complete")
def complete_nursing_hourly_round(
    round_id: str,
    principal: Annotated[DemoPrincipal, Depends(NURSING_ROLE)],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, object]:
    round_record = db.get(NursingHourlyRound, round_id)
    if round_record is None:
        raise HTTPException(status_code=404, detail="Ronda não encontrada")
    if round_record.status != "open":
        raise HTTPException(status_code=409, detail="Esta ronda já foi encerrada")
    pending_count = db.scalar(
        select(func.count(NursingHourlyRoundPatient.id)).where(
            NursingHourlyRoundPatient.round_id == round_id,
            NursingHourlyRoundPatient.status == "pending",
        )
    ) or 0
    if pending_count:
        raise HTTPException(
            status_code=409,
            detail=f"Confira ou registre uma ocorrência para os {pending_count} paciente(s) pendente(s)",
        )
    round_record.status = "completed"
    round_record.completed_by_id = principal.user_id
    round_record.completed_by_name = principal.actor_name
    round_record.completed_at = datetime.now(UTC)
    emit_audit_event(principal, "nursing", "hourly_round_completed", round_id, db=db)
    db.commit()
    db.refresh(round_record)
    return serialize_nursing_hourly_round(db, round_record)


@app.get("/api/v1/reception/arrivals")
def list_emergency_arrivals(
    principal: Annotated[DemoPrincipal, Depends(require_demo_role("reception", "nursing", "management", "admin", "oversight"))],
    db: Annotated[Session, Depends(get_nursing_db)],
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
    offset: Annotated[int, Query(ge=0)] = 0,
    status: Literal["active", "waiting", "called", "in_service", "completed", "cancelled", "admitted"] | None = None,
    q: Annotated[str, Query(max_length=120)] = "",
    from_at: datetime | None = None,
    to_at: datetime | None = None,
) -> dict[str, object]:
    filters = []
    if from_at and to_at and to_at <= from_at:
        raise HTTPException(status_code=422, detail="O fim do período deve ser posterior ao início")
    if status:
        if status == "active":
            filters.append(EmergencyArrival.status.in_(("waiting", "called", "in_service")))
        else:
            filters.append(EmergencyArrival.status == status)
    if from_at:
        filters.append(EmergencyArrival.created_at >= from_at)
    if to_at:
        filters.append(EmergencyArrival.created_at < to_at)
    search_term = q.strip()
    if search_term:
        search_pattern = f"%{search_term}%"
        filters.append(
            (EmergencyArrival.patient_name.ilike(search_pattern))
            | (EmergencyArrival.reason.ilike(search_pattern))
        )
    rows = db.execute(
        select(EmergencyArrival, Patient.allergies_status)
        .outerjoin(Patient, EmergencyArrival.patient_reference == Patient.reference)
        .where(*filters)
        .order_by(
            case(
                (EmergencyArrival.status == "waiting", 0),
                (EmergencyArrival.status == "called", 1),
                (EmergencyArrival.status == "in_service", 2),
                (EmergencyArrival.status == "completed", 3),
                (EmergencyArrival.status == "cancelled", 4),
                else_=5,
            ),
            case(
                (EmergencyArrival.clinical_priority == "urgent", 0),
                (EmergencyArrival.clinical_priority == "priority", 1),
                (EmergencyArrival.clinical_priority == "routine", 2),
                else_=3,
            ),
            EmergencyArrival.created_at.asc(),
            EmergencyArrival.id.desc(),
        )
        .offset(offset)
        .limit(limit)
    ).all()
    total = db.scalar(
        select(func.count(EmergencyArrival.id)).where(*filters)
    ) or 0
    grouped_counts = db.execute(
        select(EmergencyArrival.status, func.count(EmergencyArrival.id)).group_by(
            EmergencyArrival.status
        )
    ).all()
    emit_audit_event(principal, "reception", "emergency_arrivals_read", "emergency_queue")
    return {
        "arrivals": [
            serialize_emergency_arrival(
                arrival,
                allergies_status,
                include_allergy_details=can_view_patient_allergies(principal),
            )
            for arrival, allergies_status in rows
        ],
        "total": total,
        "limit": limit,
        "offset": offset,
        "status_counts": {key: count for key, count in grouped_counts},
    }


def serialize_nursing_triage(
    arrival: EmergencyArrival,
    triage: NursingTriage | None,
    patient: Patient | None,
    *,
    include_patient_allergies: bool,
) -> dict[str, object]:
    result: dict[str, object] = {
        "arrival_id": arrival.id,
        "patient_reference": arrival.patient_reference,
        "patient_name": arrival.patient_name,
        "arrival_mode": arrival.arrival_mode,
        "reason": arrival.reason,
        "status": arrival.status,
        "queue_type": arrival.queue_type,
        "created_at": arrival.created_at.isoformat(),
        "allergy_report_status": arrival.allergy_report_status,
        "reported_allergies": arrival.reported_allergies,
        "triage": None,
    }
    if include_patient_allergies:
        result["patient_allergies_status"] = patient.allergies_status if patient else "unknown"
        result["patient_allergies"] = patient.allergies if patient else ""
    if triage:
        result["triage"] = {
            "id": triage.id,
            "allergies_status": triage.allergies_status,
            "allergies": triage.allergies,
            "conditions_treatments": triage.conditions_treatments,
            "vital_values": triage.vital_values,
            "glucose_unit": triage.glucose_unit,
            "measured_at": triage.measured_at.isoformat() if triage.measured_at else None,
            "registered_by": triage.actor_name,
            "registered_at": triage.created_at.isoformat(),
        }
    return result


def list_triage_arrivals(
    db: Session,
    *,
    principal: DemoPrincipal,
    triaged_only: bool,
) -> dict[str, object]:
    latest_triage = (
        select(
            NursingTriage.arrival_id.label("arrival_id"),
            func.max(NursingTriage.id).label("triage_id"),
        )
        .group_by(NursingTriage.arrival_id)
        .subquery()
    )
    query = (
        select(EmergencyArrival, NursingTriage, Patient)
        .outerjoin(
            latest_triage,
            latest_triage.c.arrival_id == EmergencyArrival.id,
        )
        .outerjoin(NursingTriage, NursingTriage.id == latest_triage.c.triage_id)
        .outerjoin(Patient, Patient.reference == EmergencyArrival.patient_reference)
        .where(EmergencyArrival.status.in_(("waiting", "called", "in_service")))
    )
    if triaged_only:
        query = query.where(NursingTriage.id.is_not(None))
    else:
        query = query.where(NursingTriage.id.is_(None))
    records = db.execute(
        query.order_by(
            case(
                (EmergencyArrival.queue_type == "priority", 0),
                else_=1,
            ),
            EmergencyArrival.created_at.asc(),
            EmergencyArrival.id.desc(),
        ).limit(100)
    ).all()
    emit_audit_event(
        principal,
        "nursing" if not triaged_only else "physician",
        "nursing_triage_queue_read",
        "triage_queue",
        db=db,
    )
    return {
        "arrivals": [
            serialize_nursing_triage(
                arrival,
                triage,
                patient,
                include_patient_allergies=can_view_patient_allergies(principal),
            )
            for arrival, triage, patient in records
        ]
    }


@app.get("/api/v1/nursing/triage/arrivals")
def list_nursing_triage_arrivals(
    principal: Annotated[DemoPrincipal, Depends(NURSING_TRIAGE_READ)],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, object]:
    return list_triage_arrivals(db, principal=principal, triaged_only=False)


@app.post("/api/v1/nursing/reception-arrivals/{arrival_id}/triage", status_code=201)
def create_nursing_triage(
    arrival_id: str,
    payload: NursingTriagePayload,
    principal: Annotated[DemoPrincipal, Depends(NURSING_ROLE)],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, object]:
    arrival = db.get(EmergencyArrival, arrival_id)
    if arrival is None:
        raise HTTPException(status_code=404, detail="Chegada da Recepção não encontrada")
    if arrival.status not in {"waiting", "called", "in_service"}:
        raise HTTPException(status_code=409, detail="Esta chegada não está mais em atendimento")
    recorded_at = datetime.now(UTC)
    if payload.measured_at and payload.measured_at.astimezone(UTC) > recorded_at:
        raise HTTPException(status_code=422, detail="O horário da aferição não pode estar no futuro")
    if payload.measured_at and not any(value.strip() for value in payload.vital_values.values()):
        raise HTTPException(status_code=422, detail="Informe ao menos um sinal vital para registrar o horário")
    saturation = payload.vital_values.get("saturation", "").replace(",", ".")
    if saturation and not 0 <= float(saturation) <= 100:
        raise HTTPException(status_code=422, detail="A saturação deve estar entre 0 e 100%")
    pressure = payload.vital_values.get("pressure", "")
    if pressure:
        systolic, diastolic = (int(value) for value in pressure.split("/"))
        if systolic == 0 or diastolic == 0:
            raise HTTPException(status_code=422, detail="Informe os dois componentes da pressão arterial")
    triage = NursingTriage(
        arrival_id=arrival.id,
        patient_reference=arrival.patient_reference,
        allergies_status=payload.allergies_status,
        allergies=payload.allergies,
        conditions_treatments=payload.conditions_treatments,
        vital_values=payload.vital_values,
        glucose_unit=payload.glucose_unit,
        measured_at=(payload.measured_at or recorded_at) if payload.vital_values else None,
        actor_id=principal.user_id,
        actor_name=principal.actor_name,
        created_at=recorded_at,
    )
    db.add(triage)
    emit_audit_event(
        principal,
        "nursing",
        "nursing_triage_recorded",
        arrival.id,
        db=db,
    )
    db.commit()
    db.refresh(triage)
    patient = db.get(Patient, arrival.patient_reference) if arrival.patient_reference else None
    return serialize_nursing_triage(
        arrival,
        triage,
        patient,
        include_patient_allergies=can_view_patient_allergies(principal),
    )


@app.get("/api/v1/physicians/triage/arrivals")
def list_physician_triage_arrivals(
    principal: Annotated[DemoPrincipal, Depends(PHYSICIAN_TRIAGE_READ)],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, object]:
    return list_triage_arrivals(db, principal=principal, triaged_only=True)


@app.get("/api/v1/nursing/patients/{patient_reference}/triage-history")
def list_patient_triage_history(
    patient_reference: str,
    principal: Annotated[DemoPrincipal, CLINICAL_HISTORY_ACCESS],
    db: Annotated[Session, Depends(get_nursing_db)],
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> dict[str, object]:
    if db.get(Patient, patient_reference) is None:
        raise HTTPException(status_code=404, detail="Paciente não encontrado")
    query = (
        select(NursingTriage, EmergencyArrival)
        .join(EmergencyArrival, EmergencyArrival.id == NursingTriage.arrival_id)
        .where(NursingTriage.patient_reference == patient_reference)
    )
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    records = db.execute(
        query.order_by(NursingTriage.created_at.desc(), NursingTriage.id.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    emit_audit_event(
        principal, "nursing", "patient_triage_history_read", patient_reference
    )
    return {
        "records": [
            {
                "id": triage.id,
                "arrival_reason": arrival.reason,
                "allergies_status": triage.allergies_status,
                "allergies": triage.allergies,
                "conditions_treatments": triage.conditions_treatments,
                "vital_values": triage.vital_values,
                "glucose_unit": triage.glucose_unit,
                "measured_at": triage.measured_at.isoformat()
                if triage.measured_at
                else None,
                "actor_name": triage.actor_name,
                "created_at": triage.created_at.isoformat(),
            }
            for triage, arrival in records
        ],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@app.get("/api/v1/management/reports/triages")
def list_management_triage_report(
    principal: Annotated[
        DemoPrincipal,
        Depends(require_demo_role("management", "admin", "oversight")),
    ],
    db: Annotated[Session, Depends(get_nursing_db)],
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> dict[str, object]:
    query = (
        select(NursingTriage, EmergencyArrival)
        .join(EmergencyArrival, EmergencyArrival.id == NursingTriage.arrival_id)
        .order_by(NursingTriage.created_at.desc(), NursingTriage.id.desc())
    )
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    records = db.execute(query.limit(limit).offset(offset)).all()
    emit_audit_event(
        principal,
        "management",
        "nursing_triage_report_read",
        "triage_history",
        db=db,
    )
    return {
        "triages": [
            {
                "id": triage.id,
                "arrival_id": arrival.id,
                "patient_reference": triage.patient_reference,
                "patient_name": arrival.patient_name,
                "arrival_reason": arrival.reason,
                "queue_type": arrival.queue_type,
                "allergies_status": triage.allergies_status,
                "allergies": triage.allergies,
                "conditions_treatments": triage.conditions_treatments,
                "vital_values": triage.vital_values,
                "glucose_unit": triage.glucose_unit,
                "measured_at": triage.measured_at.isoformat() if triage.measured_at else None,
                "registered_by": triage.actor_name,
                "created_at": triage.created_at.isoformat(),
            }
            for triage, arrival in records
        ],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


class AuditTargetReference(BaseModel):
    module: str = Field(min_length=1, max_length=40)
    action: str = Field(min_length=1, max_length=80)
    target_id: str = Field(min_length=1, max_length=128)


class AuditTargetLabelsPayload(BaseModel):
    targets: list[AuditTargetReference] = Field(max_length=100)


@app.post("/api/v1/management/audit/target-labels")
def resolve_management_audit_target_labels(
    payload: AuditTargetLabelsPayload,
    principal: Annotated[
        DemoPrincipal,
        Depends(require_demo_role("management", "admin", "oversight")),
    ],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, dict[str, str]]:
    target_ids = {target.target_id for target in payload.targets}
    labels: dict[str, str] = {}
    patient_rows = db.scalars(
        select(Patient).where(Patient.reference.in_(target_ids))
    ).all() if target_ids else []
    patient_labels = {patient.reference: f"Paciente · {patient.name}" for patient in patient_rows}

    triage_arrival_ids = {
        target.target_id
        for target in payload.targets
        if target.module == "nursing" and target.action == "nursing_triage_recorded"
    }
    arrival_rows = db.scalars(
        select(EmergencyArrival).where(EmergencyArrival.id.in_(triage_arrival_ids))
    ).all() if triage_arrival_ids else []
    arrival_labels = {
        arrival.id: f"Triagem · {arrival.patient_name}"
        for arrival in arrival_rows
    }

    encounter_ids = {
        int(target.target_id)
        for target in payload.targets
        if target.module == "reception"
        and target.action == "outpatient_encounter_created"
        and target.target_id.isdecimal()
    }
    encounter_rows = db.scalars(
        select(OutpatientEncounter).where(OutpatientEncounter.id.in_(encounter_ids))
    ).all() if encounter_ids else []
    encounter_labels = {
        str(encounter.id): (
            f"Atendimento ambulatorial · "
            f"{encounter.patient_snapshot.get('name', 'Paciente sem nome')}"
        )
        for encounter in encounter_rows
    }

    for target in payload.targets:
        key = f"{target.module}:{target.action}:{target.target_id}"
        label = (
            arrival_labels.get(target.target_id)
            if target.module == "nursing" and target.action == "nursing_triage_recorded"
            else encounter_labels.get(target.target_id)
            if target.module == "reception" and target.action == "outpatient_encounter_created"
            else patient_labels.get(target.target_id)
        )
        if label:
            labels[key] = label
    return {"labels": labels}


@app.get("/api/v1/reception/public/queue")
def list_public_reception_queue(
    db: Annotated[Session, Depends(get_nursing_db)],
    response: Response,
) -> dict[str, object]:
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    timezone = ZoneInfo("America/Sao_Paulo")
    today = datetime.now(timezone).date()
    start_at = datetime.combine(today, time.min, timezone).astimezone(UTC)
    end_at = datetime.combine(today + timedelta(days=1), time.min, timezone).astimezone(UTC)

    arrivals = db.scalars(
        select(EmergencyArrival).where(
            EmergencyArrival.created_at >= start_at,
            EmergencyArrival.created_at < end_at,
        )
    ).all()
    appointment_rows = db.execute(
        select(ReceptionAppointment, Patient.name)
        .join(Patient, Patient.reference == ReceptionAppointment.patient_reference)
        .where(
            ReceptionAppointment.arrived_at.is_not(None),
            ReceptionAppointment.arrived_at >= start_at,
            ReceptionAppointment.arrived_at < end_at,
        )
    ).all()

    queue_entries: list[tuple[datetime, str, str, str, str, str, datetime, int]] = []
    for arrival in arrivals:
        queue_type = (
            "priority"
            if arrival.queue_type == "priority"
            or arrival.clinical_priority in {"priority", "urgent"}
            else "common"
        )
        queue_entries.append(
            (
                arrival.created_at,
                arrival.id,
                arrival.patient_name,
                arrival.status,
                queue_type,
                "arrival",
                arrival.updated_at,
                arrival.announcement_version,
            )
        )
    for appointment, patient_name in appointment_rows:
        if appointment.arrived_at is None:
            continue
        queue_entries.append(
            (
                appointment.arrived_at,
                str(appointment.id),
                patient_name,
                appointment.status,
                "common",
                "appointment",
                appointment.updated_at,
                appointment.announcement_version,
            )
        )

    queue_entries.sort(key=lambda item: (item[0], item[1]))
    sequence_by_queue = {"common": 0, "priority": 0}
    public_items: list[dict[str, str]] = []
    for arrived_at, item_id, patient_name, status, queue_type, item_type, updated_at, announcement_version in queue_entries:
        sequence_by_queue[queue_type] += 1
        prefix = "P" if queue_type == "priority" else "C"
        if status not in {"waiting", "arrived", "called", "in_service"}:
            continue
        code = f"{prefix}{sequence_by_queue[queue_type]:03d}"
        public_items.append(
            {
                "id": code,
                "type": item_type,
                "code": code,
                "first_name": patient_name.strip().split(maxsplit=1)[0] if patient_name.strip() else "",
                "status": "waiting" if status in {"waiting", "arrived"} else status,
                "queue_type": queue_type,
                "arrived_at": arrived_at.isoformat(),
                "updated_at": updated_at.isoformat(),
            }
        )
    return {"items": public_items, "generated_at": datetime.now(UTC).isoformat()}


SCREENSAVER_IMAGE_TYPES = {
    "image/avif": (".avif", "avif"),
    "image/jpeg": (".jpg", "jpeg"),
    "image/png": (".png", "png"),
    "image/webp": (".webp", "webp"),
}
SCREENSAVER_IMAGE_MAX_BYTES = 8 * 1024 * 1024


def reception_screensaver_directory() -> Path:
    configured_directory = os.getenv("SCPO_RECEPTION_SCREENSAVER_DIR")
    if configured_directory:
        return Path(configured_directory).expanduser().resolve()
    local_data_directory = os.getenv("SCPO_LOCAL_DATA_DIR")
    if local_data_directory:
        return (Path(local_data_directory).expanduser() / "reception-screensaver").resolve()
    return (Path(__file__).resolve().parents[2] / "data" / "reception-screensaver").resolve()


def screensaver_image_files() -> list[Path]:
    directory = reception_screensaver_directory()
    directory.mkdir(parents=True, exist_ok=True)
    return sorted(
        (
            path
            for path in directory.iterdir()
            if path.is_file() and path.suffix.lower() in {item[0] for item in SCREENSAVER_IMAGE_TYPES.values()}
        ),
        key=lambda path: path.name,
    )


def is_valid_screensaver_image(image_type: str, content: bytes) -> bool:
    if image_type == "image/jpeg":
        return content.startswith(b"\xff\xd8\xff")
    if image_type == "image/png":
        return content.startswith(b"\x89PNG\r\n\x1a\n")
    if image_type == "image/webp":
        return len(content) >= 12 and content.startswith(b"RIFF") and content[8:12] == b"WEBP"
    if image_type == "image/avif":
        return len(content) >= 12 and content[4:8] == b"ftyp" and content[8:12] in {b"avif", b"avis", b"mif1"}
    return False


@app.get("/api/v1/reception/public/screensaver/images")
def list_public_screensaver_images() -> dict[str, list[dict[str, str]]]:
    try:
        images = screensaver_image_files()
    except OSError as error:
        raise HTTPException(status_code=500, detail="Não foi possível consultar as imagens da proteção de tela") from error
    return {
        "images": [
            {
                "filename": image.name,
                "url": f"/api/v1/reception/public/screensaver/images/{image.name}",
            }
            for image in images
        ]
    }


@app.get("/api/v1/reception/public/screensaver/images/{filename}")
def get_public_screensaver_image(filename: str) -> FileResponse:
    if not re.fullmatch(r"[a-f0-9]{32}\.(?:avif|jpg|png|webp)", filename):
        raise HTTPException(status_code=404, detail="Imagem não encontrada")
    image_path = reception_screensaver_directory() / filename
    if not image_path.is_file():
        raise HTTPException(status_code=404, detail="Imagem não encontrada")
    media_type = next(
        (media_type for media_type, (extension, _) in SCREENSAVER_IMAGE_TYPES.items() if extension == image_path.suffix),
        None,
    )
    if media_type is None:
        raise HTTPException(status_code=404, detail="Imagem não encontrada")
    return FileResponse(
        image_path,
        media_type=media_type,
        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
    )


@app.post("/api/v1/reception/screensaver/images", status_code=201)
async def upload_reception_screensaver_image(
    request: Request,
    principal: Annotated[DemoPrincipal, Depends(require_demo_role("reception"))],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, str]:
    image_type = request.headers.get("content-type", "").split(";", maxsplit=1)[0].strip().lower()
    image_details = SCREENSAVER_IMAGE_TYPES.get(image_type)
    if image_details is None:
        raise HTTPException(status_code=415, detail="Formato não aceito. Envie JPG, PNG, WebP ou AVIF.")

    content = bytearray()
    async for chunk in request.stream():
        content.extend(chunk)
        if len(content) > SCREENSAVER_IMAGE_MAX_BYTES:
            raise HTTPException(status_code=413, detail="Cada imagem deve ter no máximo 8 MB.")
    if not is_valid_screensaver_image(image_type, content):
        raise HTTPException(status_code=422, detail="O arquivo não corresponde a uma imagem válida do formato informado.")

    extension, audit_label = image_details
    filename = f"{uuid.uuid4().hex}{extension}"
    directory = reception_screensaver_directory()
    image_path = directory / filename
    try:
        directory.mkdir(parents=True, exist_ok=True)
        image_path.write_bytes(content)
        emit_audit_event(principal, "reception", "screensaver_image_uploaded", filename, db=db)
        db.commit()
    except Exception:
        db.rollback()
        try:
            image_path.unlink(missing_ok=True)
        except OSError as cleanup_error:
            raise RuntimeError("Não foi possível finalizar ou limpar o upload da imagem.") from cleanup_error
        raise
    return {
        "filename": filename,
        "url": f"/api/v1/reception/public/screensaver/images/{filename}",
        "format": audit_label,
    }


@app.delete("/api/v1/reception/screensaver/images/{filename}", status_code=204)
def delete_reception_screensaver_image(
    filename: str,
    principal: Annotated[DemoPrincipal, Depends(require_demo_role("reception"))],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> Response:
    if not re.fullmatch(r"[a-f0-9]{32}\.(?:avif|jpg|png|webp)", filename):
        raise HTTPException(status_code=404, detail="Imagem não encontrada")
    image_path = reception_screensaver_directory() / filename
    if not image_path.is_file():
        raise HTTPException(status_code=404, detail="Imagem não encontrada")
    content = image_path.read_bytes()
    image_path.unlink()
    try:
        emit_audit_event(principal, "reception", "screensaver_image_deleted", filename, db=db)
        db.commit()
    except Exception:
        db.rollback()
        try:
            image_path.write_bytes(content)
        except OSError as restore_error:
            raise RuntimeError("A exclusão falhou e não foi possível restaurar a imagem; contate o suporte.") from restore_error
        raise
    return Response(status_code=204)


def get_reception_queue_settings(db: Session) -> ReceptionQueueSettings:
    settings = db.get(ReceptionQueueSettings, 1)
    if settings is None:
        raise RuntimeError("As configurações da fila da recepção não foram inicializadas pela migração")
    return settings


def record_manual_reception_call(
    db: Session,
    principal: DemoPrincipal,
    clinical_priority: str,
) -> None:
    settings = db.scalar(
        select(ReceptionQueueSettings)
        .where(ReceptionQueueSettings.id == 1)
        .with_for_update()
    )
    if settings is None:
        raise RuntimeError("As configurações da fila da recepção não foram inicializadas pela migração")
    if clinical_priority in {"priority", "urgent"}:
        settings.normal_calls_since_priority = 0
    else:
        settings.normal_calls_since_priority = min(
            settings.normal_before_priority,
            settings.normal_calls_since_priority + 1,
        )
    settings.updated_by = principal.actor_name
    settings.updated_at = datetime.now(UTC)


@app.get("/api/v1/reception/queue-settings")
def read_reception_queue_settings(
    principal: Annotated[DemoPrincipal, Depends(require_demo_role("reception", "nursing", "management"))],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, int]:
    settings = get_reception_queue_settings(db)
    emit_audit_event(principal, "reception", "queue_call_settings_read", "reception_queue_settings")
    return {
        "normal_before_priority": settings.normal_before_priority,
        "normal_calls_since_priority": settings.normal_calls_since_priority,
    }


@app.patch("/api/v1/reception/queue-settings")
def update_reception_queue_settings(
    payload: ReceptionQueueSettingsPayload,
    principal: Annotated[DemoPrincipal, Depends(require_demo_role("reception"))],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, int]:
    settings = get_reception_queue_settings(db)
    settings.normal_before_priority = payload.normal_before_priority
    settings.updated_by = principal.actor_name
    settings.updated_at = datetime.now(UTC)
    emit_audit_event(principal, "reception", "queue_call_settings_updated", "reception_queue_settings", db=db)
    db.commit()
    return {"normal_before_priority": settings.normal_before_priority}


@app.post("/api/v1/reception/queue/call-next")
def call_next_reception_queue_item(
    payload: ReceptionQueueCallPayload,
    principal: Annotated[DemoPrincipal, Depends(require_demo_role("reception"))],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, object]:
    settings = db.scalar(
        select(ReceptionQueueSettings)
        .where(ReceptionQueueSettings.id == 1)
        .with_for_update()
    )
    if settings is None:
        raise RuntimeError("As configurações da fila da recepção não foram inicializadas pela migração")

    common_arrivals = db.scalars(
        select(EmergencyArrival)
        .where(
            EmergencyArrival.status == "waiting",
            EmergencyArrival.queue_type == "common",
        )
        .order_by(EmergencyArrival.created_at, EmergencyArrival.id)
        .with_for_update()
    ).all()
    common_appointments = db.scalars(
        select(ReceptionAppointment)
        .where(
            ReceptionAppointment.status == "arrived",
            ReceptionAppointment.arrived_at.is_not(None),
        )
        .order_by(ReceptionAppointment.arrived_at, ReceptionAppointment.id)
        .with_for_update()
    ).all()
    priority_arrivals = db.scalars(
        select(EmergencyArrival)
        .where(
            EmergencyArrival.status == "waiting",
            or_(
                EmergencyArrival.queue_type == "priority",
                EmergencyArrival.clinical_priority.in_(("priority", "urgent")),
            ),
        )
        .order_by(
            case(
                (EmergencyArrival.clinical_priority == "urgent", 0),
                else_=1,
            ),
            EmergencyArrival.created_at,
            EmergencyArrival.id,
        )
        .with_for_update()
    ).all()

    common_candidates: list[tuple[datetime, str, EmergencyArrival | ReceptionAppointment]] = [
        (arrival.created_at, "arrival", arrival) for arrival in common_arrivals
    ]
    common_candidates.extend(
        (appointment.arrived_at, "appointment", appointment)
        for appointment in common_appointments
        if appointment.arrived_at is not None
    )
    common_candidates.sort(key=lambda item: (item[0], item[2].id))
    chosen: tuple[datetime, str, EmergencyArrival | ReceptionAppointment] | None = None

    if payload.mode == "common":
        chosen = common_candidates[0] if common_candidates else None
        settings.normal_calls_since_priority = min(
            settings.normal_before_priority,
            settings.normal_calls_since_priority + 1,
        )
    elif payload.mode == "priority":
        chosen = (
            (priority_arrivals[0].created_at, "arrival", priority_arrivals[0])
            if priority_arrivals
            else None
        )
        if chosen:
            settings.normal_calls_since_priority = 0
    elif common_candidates and priority_arrivals:
        if settings.normal_calls_since_priority >= settings.normal_before_priority:
            chosen = (priority_arrivals[0].created_at, "arrival", priority_arrivals[0])
            settings.normal_calls_since_priority = 0
        else:
            chosen = common_candidates[0]
            settings.normal_calls_since_priority += 1
    elif common_candidates:
        chosen = common_candidates[0]
        settings.normal_calls_since_priority = min(
            settings.normal_before_priority,
            settings.normal_calls_since_priority + 1,
        )
    elif priority_arrivals:
        chosen = (priority_arrivals[0].created_at, "arrival", priority_arrivals[0])
        settings.normal_calls_since_priority = 0

    if chosen is None:
        db.rollback()
        raise HTTPException(status_code=409, detail="Não há pacientes aguardando nessa fila")

    _, item_type, item = chosen
    item.status = "called"
    if item_type == "arrival":
        item.updated_by = principal.actor_name
        item.updated_at = datetime.now(UTC)
        item_id = item.id
        patient_name = item.patient_name
        clinical_priority = item.clinical_priority
        called_at = item.updated_at
    else:
        item.updated_by_name = principal.actor_name
        item.updated_at = datetime.now(UTC)
        item_id = str(item.id)
        patient = db.get(Patient, item.patient_reference)
        patient_name = patient.name if patient else ""
        clinical_priority = "routine"
        called_at = item.updated_at

    settings.updated_by = principal.actor_name
    settings.updated_at = datetime.now(UTC)
    emit_audit_event(
        principal,
        "reception",
        "waiting_room_patient_called",
        item_id,
        db=db,
    )
    db.commit()
    return {
        "type": item_type,
        "id": item_id,
        "patient_name": patient_name,
        "status": "called",
        "clinical_priority": clinical_priority,
        "called_at": called_at.isoformat(),
        "normal_calls_since_priority": settings.normal_calls_since_priority,
    }


@app.patch("/api/v1/reception/arrivals/{arrival_id}/clinical-priority")
def update_emergency_clinical_priority(
    arrival_id: str,
    payload: EmergencyClinicalPriorityPayload,
    principal: Annotated[DemoPrincipal, Depends(NURSING_ROLE)],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, object]:
    arrival = db.get(EmergencyArrival, arrival_id)
    if arrival is None:
        raise HTTPException(status_code=404, detail="Atendimento não encontrado")
    if arrival.status in {"completed", "cancelled", "admitted"}:
        raise HTTPException(status_code=409, detail="Não é possível reclassificar um atendimento encerrado")
    arrival.clinical_priority = payload.clinical_priority
    arrival.clinical_priority_updated_by = principal.actor_name
    arrival.clinical_priority_updated_at = datetime.now(UTC)
    arrival.clinical_priority_reason = payload.reason
    emit_audit_event(
        principal, "nursing", "emergency_clinical_priority_updated", arrival.id, db=db
    )
    db.commit()
    db.refresh(arrival)
    patient = db.get(Patient, arrival.patient_reference) if arrival.patient_reference else None
    return serialize_emergency_arrival(
        arrival,
        patient.allergies_status if patient else "unknown",
        include_allergy_details=can_view_patient_allergies(principal),
    )


@app.post("/api/v1/reception/arrivals", status_code=201)
def create_emergency_arrival(
    payload: EmergencyArrivalPayload,
    principal: Annotated[DemoPrincipal, Depends(require_demo_role("reception"))],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, object]:
    patient = None
    if payload.patient_reference:
        patient = db.get(Patient, payload.patient_reference)
        if patient is None or not patient.active:
            raise HTTPException(status_code=404, detail="Paciente não encontrado ou inativo")
    now = datetime.now(UTC)
    if payload.new_patient:
        patient_payload = payload.new_patient
        if patient_payload.cpf and db.scalar(
            select(Patient.reference).where(Patient.cpf == patient_payload.cpf)
        ):
            raise HTTPException(status_code=409, detail="Já existe um paciente cadastrado com este CPF")
        if patient_payload.sus_card and db.scalar(
            select(Patient.reference).where(Patient.sus_card == patient_payload.sus_card)
        ):
            raise HTTPException(status_code=409, detail="Já existe um paciente cadastrado com este Cartão SUS")
        patient = Patient(
            reference=str(uuid.uuid4()),
            name=patient_payload.name,
            mother_name=patient_payload.mother_name,
            health_plan=patient_payload.health_plan,
            same_number=patient_payload.same_number,
            room="",
            bed="",
            cpf=patient_payload.cpf,
            sus_card=patient_payload.sus_card,
            allergies=patient_payload.allergies,
            allergies_status=patient_payload.allergies_status,
            birth_date=patient_payload.birth_date,
            sex=patient_payload.sex,
            phone=patient_payload.phone,
            email=patient_payload.email,
            address=patient_payload.address,
            address_number=patient_payload.address_number,
            address_complement=patient_payload.address_complement,
            neighborhood=patient_payload.neighborhood,
            city=patient_payload.city,
            state=patient_payload.state,
            postal_code=patient_payload.postal_code,
            responsible_name=patient_payload.responsible_name,
            responsible_status=patient_payload.responsible_status,
            responsible_relationship=patient_payload.responsible_relationship,
            responsible_phone=patient_payload.responsible_phone,
            responsible_address=patient_payload.responsible_address,
            responsible_address_number=patient_payload.responsible_address_number,
            responsible_address_complement=patient_payload.responsible_address_complement,
            responsible_neighborhood=patient_payload.responsible_neighborhood,
            responsible_city=patient_payload.responsible_city,
            responsible_state=patient_payload.responsible_state,
            responsible_postal_code=patient_payload.responsible_postal_code,
            created_at=now,
            updated_at=now,
            updated_by=principal.actor_name,
            active=True,
        )
        db.add(patient)
        db.flush()
    arrival = EmergencyArrival(
        id=str(uuid.uuid4()),
        patient_reference=patient.reference if patient else None,
        patient_name=patient.name if patient else payload.patient_name.strip(),
        arrival_mode=payload.arrival_mode,
        reason=payload.reason,
        allergy_report_status=payload.allergy_report_status,
        reported_allergies=payload.reported_allergies.strip(),
        status="waiting",
        queue_type=payload.queue_type,
        created_by=principal.actor_name,
        updated_by=principal.actor_name,
        created_at=now,
        updated_at=now,
    )
    db.add(arrival)
    if payload.new_patient and patient and patient.allergies_status != "unknown":
        record_patient_allergy_change(
            db,
            principal,
            patient,
            patient.allergies_status,
            patient.allergies,
            "Registro inicial no cadastro de emergência",
            previous_status="unknown",
            previous_details="",
        )
    if payload.new_patient and patient:
        emit_audit_event(
            principal, "patients", "emergency_patient_created", patient.reference, db=db
        )
    emit_audit_event(
        principal, "reception", "emergency_arrival_created", arrival.id, db=db
    )
    db.commit()
    db.refresh(arrival)
    return serialize_emergency_arrival(
        arrival,
        patient.allergies_status if patient else "unknown",
        include_allergy_details=can_view_patient_allergies(principal),
    )


@app.get("/api/v1/reception/appointments")
def list_reception_appointments(
    principal: Annotated[DemoPrincipal, Depends(require_demo_role("reception", "nursing", "management"))],
    db: Annotated[Session, Depends(get_nursing_db)],
    limit: Annotated[int, Query(ge=1, le=500)] = 500,
    offset: Annotated[int, Query(ge=0)] = 0,
    from_at: datetime | None = None,
    to_at: datetime | None = None,
    status: Literal["scheduled", "confirmed", "arrived", "called", "completed", "cancelled", "no_show"] | None = None,
    q: Annotated[str, Query(max_length=120)] = "",
) -> dict[str, object]:
    if any(value and (value.tzinfo is None or value.utcoffset() is None) for value in (from_at, to_at)):
        raise HTTPException(status_code=422, detail="Informe o período com fuso horário")
    if from_at:
        from_at = from_at.astimezone(UTC)
    if to_at:
        to_at = to_at.astimezone(UTC)
    if from_at and to_at and to_at <= from_at:
        raise HTTPException(status_code=422, detail="O período final deve ser posterior ao inicial")

    filters = []
    if from_at:
        filters.append(ReceptionAppointment.starts_at >= from_at)
    if to_at:
        filters.append(ReceptionAppointment.starts_at < to_at)
    if status:
        filters.append(ReceptionAppointment.status == status)
    search_term = q.strip()
    if search_term:
        search_pattern = f"%{search_term}%"
        filters.append(
            or_(
                Patient.name.ilike(search_pattern),
                ReceptionAppointment.professional_name.ilike(search_pattern),
                ReceptionAppointment.location.ilike(search_pattern),
            )
        )

    rows = db.execute(
        select(ReceptionAppointment, Patient.name)
        .join(Patient, Patient.reference == ReceptionAppointment.patient_reference)
        .where(*filters)
        .order_by(ReceptionAppointment.starts_at, ReceptionAppointment.id)
        .limit(limit)
        .offset(offset)
    ).all()
    total = db.scalar(
        select(func.count(ReceptionAppointment.id))
        .join(Patient, Patient.reference == ReceptionAppointment.patient_reference)
        .where(*filters)
    ) or 0
    emit_audit_event(principal, "reception", "appointments_read", "appointment_schedule")
    return {
        "appointments": [
            serialize_reception_appointment(appointment, patient_name)
            for appointment, patient_name in rows
        ],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@app.post("/api/v1/reception/appointments", status_code=201)
def create_reception_appointment(
    payload: ReceptionAppointmentPayload,
    principal: Annotated[DemoPrincipal, Depends(require_demo_role("reception"))],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, object]:
    patient = db.get(Patient, payload.patient_reference)
    if patient is None or not patient.active:
        raise HTTPException(status_code=404, detail="Paciente não encontrado ou inativo")

    overlapping = db.scalar(
        select(ReceptionAppointment.id)
        .where(
            ReceptionAppointment.status.not_in(("completed", "cancelled", "no_show")),
            ReceptionAppointment.starts_at < payload.ends_at,
            ReceptionAppointment.ends_at > payload.starts_at,
            or_(
                ReceptionAppointment.patient_reference == patient.reference,
                func.lower(ReceptionAppointment.professional_name)
                == payload.professional_name.lower(),
                func.lower(ReceptionAppointment.location) == payload.location.lower(),
            ),
        )
        .limit(1)
    )
    if overlapping is not None:
        raise HTTPException(
            status_code=409,
            detail="Conflito de horário: paciente, profissional ou local já possui agendamento nesse período",
        )

    now = datetime.now(UTC)
    appointment = ReceptionAppointment(
        patient_reference=patient.reference,
        appointment_type=payload.appointment_type,
        professional_name=payload.professional_name,
        location=payload.location,
        purpose=payload.purpose,
        starts_at=payload.starts_at,
        ends_at=payload.ends_at,
        status="scheduled",
        created_by=principal.user_id,
        created_by_name=principal.actor_name,
        updated_by_name=principal.actor_name,
        created_at=now,
        updated_at=now,
    )
    db.add(appointment)
    db.flush()
    emit_audit_event(
        principal, "reception", "appointment_created", str(appointment.id), db=db
    )
    db.commit()
    db.refresh(appointment)
    return serialize_reception_appointment(appointment, patient.name)


@app.patch("/api/v1/reception/appointments/{appointment_id}")
def update_reception_appointment_status(
    appointment_id: int,
    payload: ReceptionAppointmentStatusPayload,
    principal: Annotated[DemoPrincipal, Depends(require_demo_role("reception"))],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, object]:
    appointment = db.get(ReceptionAppointment, appointment_id)
    if appointment is None:
        raise HTTPException(status_code=404, detail="Agendamento não encontrado")
    transitions = {
        "scheduled": {"confirmed", "arrived", "cancelled", "no_show"},
        "confirmed": {"arrived", "cancelled", "no_show"},
        "arrived": {"called", "completed"},
        "called": {"completed"},
    }
    if payload.status not in transitions.get(appointment.status, set()):
        raise HTTPException(
            status_code=409,
            detail="Esta mudança de situação não é permitida para o agendamento",
        )

    appointment.status = payload.status
    if payload.status == "called":
        record_manual_reception_call(db, principal, "routine")
    if payload.status == "arrived" and appointment.arrived_at is None:
        appointment.arrived_at = datetime.now(UTC)
    appointment.updated_by_name = principal.actor_name
    appointment.updated_at = datetime.now(UTC)
    emit_audit_event(
        principal,
        "reception",
        "appointment_status_updated",
        str(appointment.id),
        db=db,
    )
    db.commit()
    db.refresh(appointment)
    patient = db.get(Patient, appointment.patient_reference)
    return serialize_reception_appointment(appointment, patient.name if patient else "")


@app.get("/api/v1/reception/encounters")
def list_outpatient_encounters(
    principal: Annotated[
        DemoPrincipal,
        Depends(
            require_demo_role(
                "reception",
                "nursing",
                "physician",
                "psychology",
                "management",
                "admin",
                "oversight",
            )
        ),
    ],
    db: Annotated[Session, Depends(get_nursing_db)],
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    patient_reference: str | None = None,
) -> dict[str, object]:
    query = select(OutpatientEncounter)
    if patient_reference:
        query = query.where(OutpatientEncounter.patient_reference == patient_reference)
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    encounters = db.scalars(
        query.order_by(OutpatientEncounter.created_at.desc(), OutpatientEncounter.id.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    emit_audit_event(principal, "reception", "outpatient_encounters_read", patient_reference or "all")
    return {
        "encounters": [serialize_outpatient_encounter(encounter) for encounter in encounters],
        "total": total,
    }


@app.post("/api/v1/reception/encounters", status_code=201)
def create_outpatient_encounter(
    payload: OutpatientEncounterPayload,
    principal: Annotated[DemoPrincipal, Depends(require_demo_role("reception"))],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, object]:
    if payload.new_patient:
        patient = create_patient_record(db, principal, payload.new_patient)
    else:
        patient = db.get(Patient, payload.patient_reference)
        if patient is None or not patient.active:
            raise HTTPException(status_code=404, detail="Paciente não encontrado ou inativo")

    now = datetime.now(UTC)
    patient_snapshot = snapshot_outpatient_patient(patient)
    patient_snapshot["same_number"] = patient.same_number or payload.same_number
    encounter = OutpatientEncounter(
        patient_reference=patient.reference,
        patient_snapshot=patient_snapshot,
        encounter_type=payload.encounter_type,
        physician_name=payload.physician_name,
        examination=payload.examination,
        activity_rows=[
            row.model_dump()
            for row in payload.activity_rows
            if row.professional_activity or row.procedure
        ],
        group_name=payload.group_name,
        programs=payload.programs,
        diagnostic_hypothesis=payload.diagnostic_hypothesis,
        antibiotic_prescription=payload.antibiotic_prescription,
        referral=payload.referral,
        created_by=principal.actor_name,
        created_at=now,
    )
    db.add(encounter)
    arrival = EmergencyArrival(
        id=str(uuid.uuid4()),
        patient_reference=patient.reference,
        patient_name=patient.name,
        arrival_mode="walk_in",
        reason=OUTPATIENT_ARRIVAL_REASON,
        status="waiting",
        created_by=principal.actor_name,
        updated_by=principal.actor_name,
        created_at=now,
        updated_at=now,
        clinical_priority="routine",
        queue_type=payload.queue_type,
    )
    db.add(arrival)
    db.flush()
    emit_audit_event(principal, "reception", "outpatient_encounter_created", str(encounter.id), db=db)
    emit_audit_event(principal, "reception", "emergency_arrival_created", arrival.id, db=db)
    db.commit()
    db.refresh(encounter)
    result = serialize_outpatient_encounter(encounter)
    result["arrival_id"] = arrival.id
    return result


@app.patch("/api/v1/reception/arrivals/{arrival_id}")
def update_emergency_arrival(
    arrival_id: str,
    payload: EmergencyArrivalStatusPayload,
    principal: Annotated[DemoPrincipal, Depends(require_demo_role("reception"))],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, object]:
    arrival = db.get(EmergencyArrival, arrival_id)
    if arrival is None:
        raise HTTPException(status_code=404, detail="Atendimento não encontrado")
    if arrival.status in {"completed", "cancelled"}:
        raise HTTPException(status_code=409, detail="O atendimento já foi encerrado")
    transitions = {
        "waiting": {"called", "in_service", "completed", "cancelled"},
        "called": {"waiting", "in_service", "completed", "cancelled"},
        "in_service": {"completed", "cancelled"},
    }
    if payload.status not in transitions.get(arrival.status, set()):
        raise HTTPException(status_code=409, detail="Transição da chegada não permitida")
    if payload.status == "called" and arrival.status == "waiting":
        record_manual_reception_call(db, principal, arrival.clinical_priority)
    arrival.status = payload.status
    arrival.updated_by = principal.actor_name
    arrival.updated_at = datetime.now(UTC)
    emit_audit_event(
        principal, "reception", "emergency_arrival_status_updated", arrival.id, db=db
    )
    db.commit()
    db.refresh(arrival)
    patient = db.get(Patient, arrival.patient_reference) if arrival.patient_reference else None
    return serialize_emergency_arrival(
        arrival,
        patient.allergies_status if patient else "unknown",
        include_allergy_details=can_view_patient_allergies(principal),
    )


@app.post("/api/v1/reception/arrivals/{arrival_id}/admission")
def admit_emergency_arrival(
    arrival_id: str,
    payload: EmergencyAdmissionPayload,
    principal: Annotated[DemoPrincipal, Depends(require_demo_role("reception"))],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, object]:
    arrival = db.get(EmergencyArrival, arrival_id)
    if arrival is None:
        raise HTTPException(status_code=404, detail="Atendimento não encontrado")
    if arrival.status in {"completed", "cancelled", "admitted"}:
        raise HTTPException(status_code=409, detail="O atendimento não pode ser convertido em internação")
    if not arrival.patient_reference:
        raise HTTPException(status_code=409, detail="Vincule ou crie o cadastro central do paciente antes da internação")
    patient = db.get(Patient, arrival.patient_reference)
    if patient is None or not patient.active:
        raise HTTPException(status_code=404, detail="Paciente não encontrado ou inativo")
    if _active_assignment_for_patient(db, patient.reference):
        raise HTTPException(status_code=409, detail="Este paciente já está vinculado a um leito físico")
    bed, _ = _available_hospital_bed(
        db, payload.bed_id, exclude_patient_reference=patient.reference
    )
    now = datetime.now(UTC)
    patient.treatment_track = payload.treatment_track
    _assign_patient_to_bed(db, patient, bed, principal, now)
    arrival.status = "admitted"
    arrival.updated_by = principal.actor_name
    arrival.updated_at = now
    flow_event = PatientFlowEvent(
        patient_reference=patient.reference,
        event_type="admission",
        next_room=bed.room,
        next_bed=bed.label,
        reason="Internação pela recepção",
        actor_id=principal.user_id,
        actor_name=principal.actor_name,
        occurred_at=now,
    )
    db.add(flow_event)
    emit_audit_event(
        principal, "reception", "emergency_arrival_admitted", arrival.id, db=db
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="O leito foi ocupado por outra operação; atualize o mapa") from exc
    return {
        "arrival": serialize_emergency_arrival(
            arrival,
            patient.allergies_status,
            include_allergy_details=can_view_patient_allergies(principal),
        ),
        "patient": serialize_patient(patient, principal=principal),
        "flow_event": serialize_patient_flow_event(flow_event),
    }


@app.get("/api/v1/nursing/medication-administrations")
def list_medication_administrations(
    principal: Annotated[DemoPrincipal, Depends(require_demo_role("nursing", "management", "admin", "oversight"))],
    db: Annotated[Session, Depends(get_nursing_db)],
    patient_reference: str | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 500,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> dict[str, object]:
    query = select(MedicationAdministration)
    if patient_reference:
        query = query.where(MedicationAdministration.patient_reference == patient_reference)
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    records = db.scalars(
        query.order_by(MedicationAdministration.administered_at.desc()).offset(offset).limit(limit)
    ).all()
    emit_audit_event(principal, "nursing", "medication_administrations_read", "medication_administrations")
    return {"administrations": [serialize_medication_administration(record) for record in records], "total": total, "limit": limit, "offset": offset}


@app.get("/api/v1/nursing/scheduled-medication-administrations")
def list_scheduled_medication_administrations(
    principal: Annotated[DemoPrincipal, Depends(require_demo_role("nursing", "management", "admin", "oversight"))],
    db: Annotated[Session, Depends(get_nursing_db)],
    scheduled_date: date,
    scheduled_time: str = Query(pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$"),
) -> dict[str, object]:
    records = db.scalars(
        select(ScheduledMedicationAdministration)
        .where(
            ScheduledMedicationAdministration.scheduled_date == scheduled_date,
            ScheduledMedicationAdministration.scheduled_time == scheduled_time,
        )
        .order_by(ScheduledMedicationAdministration.patient_reference)
    ).all()
    emit_audit_event(principal, "nursing", "scheduled_medication_administrations_read", f"{scheduled_date.isoformat()} {scheduled_time}")
    return {"administrations": [serialize_scheduled_medication_administration(record) for record in records]}


@app.post("/api/v1/nursing/scheduled-medication-administrations", status_code=201)
def create_scheduled_medication_administrations(
    payload: ScheduledMedicationAdministrationBatch,
    principal: Annotated[DemoPrincipal, Depends(NURSING_ROLE)],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, object]:
    prescriptions = {
        prescription.id: prescription
        for prescription in db.scalars(
            select(PhysicianPrescription).where(
                PhysicianPrescription.id.in_([item.prescription_reference for item in payload.items])
            )
        ).all()
    }
    records: list[ScheduledMedicationAdministration] = []
    for item in payload.items:
        prescription = prescriptions.get(item.prescription_reference)
        if prescription is None:
            raise HTTPException(status_code=404, detail="Uma das prescrições selecionadas não foi encontrada")
        if prescription.status == "cancelled":
            raise HTTPException(status_code=409, detail="Prescrição cancelada não pode ter administração registrada")
        if payload.scheduled_time not in (prescription.administration_times or []):
            raise HTTPException(status_code=409, detail="O horário não corresponde aos horários definidos na prescrição")
        patient = db.get(Patient, prescription.patient_reference)
        if patient is None or not patient.active:
            raise HTTPException(status_code=409, detail="Paciente inativo ou não encontrado")
        records.append(
            ScheduledMedicationAdministration(
                prescription_reference=prescription.id,
                patient_reference=patient.reference,
                scheduled_date=payload.scheduled_date,
                scheduled_time=payload.scheduled_time,
                status=item.status,
                reason=item.reason,
                actor_id=principal.user_id,
                actor_name=principal.actor_name,
                recorded_at=datetime.now(UTC),
            )
        )
    db.add_all(records)
    for record in records:
        emit_audit_event(
            principal,
            "nursing",
            "scheduled_medication_administration_recorded",
            f"{record.patient_reference}:{payload.scheduled_date.isoformat()}:{payload.scheduled_time}",
            db=db,
        )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Uma ou mais administrações deste horário já foram registradas") from exc
    return {"administrations": [serialize_scheduled_medication_administration(record) for record in records]}


@app.get("/api/v1/physicians/profile")
def get_physician_profile(
    principal: Annotated[DemoPrincipal, Depends(PHYSICIAN_PROFILE_READ_ACCESS)],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, object]:
    profile = db.get(PhysicianProfile, principal.user_id)
    return {"profile": serialize_physician_profile(profile) if profile else None}


@app.get("/api/v1/physicians/profiles")
def list_physician_profiles(
    principal: Annotated[DemoPrincipal, Depends(require_demo_role("management", "admin"))],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, list[dict[str, object]]]:
    profiles = db.scalars(
        select(PhysicianProfile).order_by(PhysicianProfile.name, PhysicianProfile.user_id)
    ).all()
    emit_audit_event(principal, "physician", "physician_profiles_read", "all", db=db)
    return {"profiles": [serialize_physician_profile(profile) for profile in profiles]}


@app.put("/api/v1/physicians/profiles/{user_id}")
def save_physician_profile_as_management(
    user_id: str,
    payload: PhysicianProfilePayload,
    principal: Annotated[DemoPrincipal, Depends(require_demo_role("management", "admin"))],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, object]:
    if not user_id.strip() or len(user_id) > 36:
        raise HTTPException(status_code=422, detail="Identificador de usuário inválido")
    profile = db.get(PhysicianProfile, user_id)
    now = datetime.now(UTC)
    if profile is None:
        profile = PhysicianProfile(user_id=user_id, updated_at=now, **payload.model_dump())
        db.add(profile)
    else:
        for field, value in payload.model_dump().items():
            setattr(profile, field, value)
        profile.updated_at = now
    emit_audit_event(principal, "physician", "physician_profile_admin_updated", user_id, db=db)
    db.commit()
    db.refresh(profile)
    return serialize_physician_profile(profile)


@app.put("/api/v1/physicians/profile")
def save_physician_profile(
    payload: PhysicianProfilePayload,
    principal: Annotated[DemoPrincipal, Depends(PHYSICIAN_ACCESS)],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, object]:
    raise HTTPException(
        status_code=403,
        detail="O perfil profissional deve ser cadastrado pela Administração.",
    )


@app.delete("/internal/v1/physicians/profiles/{user_id}", status_code=204)
def delete_physician_profile(
    user_id: str,
    _: Annotated[None, Depends(require_service_token)],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> None:
    profile = db.get(PhysicianProfile, user_id)
    if profile is not None:
        db.delete(profile)
        db.commit()


@app.get("/api/v1/physicians/prescriptions")
def list_physician_prescriptions(
    principal: Annotated[DemoPrincipal, Depends(PRESCRIPTION_READ_ACCESS)],
    db: Annotated[Session, Depends(get_nursing_db)],
    patient_reference: str | None = None,
    status: Literal["pending", "fulfilled", "cancelled"] | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 500,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> dict[str, object]:
    query = select(PhysicianPrescription)
    if patient_reference:
        query = query.where(PhysicianPrescription.patient_reference == patient_reference)
    if status:
        query = query.where(PhysicianPrescription.status == status)
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    records = db.scalars(
        query.order_by(PhysicianPrescription.created_at.desc()).offset(offset).limit(limit)
    ).all()
    emit_audit_event(principal, "physician", "physician_prescriptions_read", patient_reference or "all")
    return {"prescriptions": [serialize_physician_prescription(record) for record in records], "total": total, "limit": limit, "offset": offset}


@app.post("/api/v1/physicians/prescriptions", status_code=201)
def create_physician_prescription(
    payload: PhysicianPrescriptionPayload,
    principal: Annotated[DemoPrincipal, Depends(PHYSICIAN_ACCESS)],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, object]:
    patient = db.get(Patient, payload.patient_reference)
    if patient is None or not patient.active:
        raise HTTPException(status_code=404, detail="Paciente ativo não encontrado")
    profile = db.get(PhysicianProfile, principal.user_id)
    if profile is None:
        raise HTTPException(status_code=409, detail="Cadastre e valide os dados profissionais antes de prescrever")
    now = datetime.now(UTC)
    prescription = PhysicianPrescription(
        id=str(uuid.uuid4()),
        **payload.model_dump(),
        prescriber_id=principal.user_id,
        prescriber_name=profile.name,
        crm=profile.crm,
        crm_state=profile.crm_state,
        status="pending",
        created_at=now,
        updated_at=now,
    )
    db.add(prescription)
    emit_audit_event(
        principal,
        "physician",
        "physician_prescription_created",
        prescription.patient_reference,
        db=db,
    )
    db.commit()
    db.refresh(prescription)
    return serialize_physician_prescription(prescription)


@app.patch("/api/v1/physicians/prescriptions/{prescription_id}")
def update_physician_prescription(
    prescription_id: str,
    payload: PhysicianPrescriptionStatusPayload,
    principal: Annotated[DemoPrincipal, Depends(require_demo_role("physician", "pharmacy", "management"))],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, object]:
    prescription = db.get(PhysicianPrescription, prescription_id)
    if prescription is None:
        raise HTTPException(status_code=404, detail="Prescrição interna não encontrada")
    modules = set(principal.modules)
    if payload.status == "fulfilled" and not principal.is_superuser and not {"pharmacy", "management"} & modules:
        raise HTTPException(status_code=403, detail="Somente Farmácia pode confirmar o atendimento da prescrição")
    if payload.status == "cancelled" and not (
        principal.is_superuser
        or "management" in modules
        or prescription.prescriber_id == principal.user_id
    ):
        raise HTTPException(status_code=403, detail="Somente o prescritor pode cancelar esta prescrição")
    if prescription.status != "pending":
        raise HTTPException(status_code=409, detail="A prescrição já foi atendida ou cancelada")
    prescription.status = payload.status
    prescription.updated_at = datetime.now(UTC)
    emit_audit_event(
        principal,
        "physician",
        f"physician_prescription_{payload.status}",
        prescription.patient_reference,
        db=db,
    )
    db.commit()
    db.refresh(prescription)
    return serialize_physician_prescription(prescription)


@app.post("/internal/v1/physicians/prescriptions/resolve")
def resolve_pharmacy_prescription(
    payload: InternalPrescriptionResolutionPayload,
    db: Annotated[Session, Depends(get_nursing_db)],
    _: Annotated[None, Depends(require_service_token)],
) -> dict[str, object]:
    prescription = db.scalar(
        select(PhysicianPrescription)
        .where(PhysicianPrescription.id == payload.prescription_reference)
        .with_for_update()
    )
    if prescription is None:
        raise HTTPException(status_code=404, detail="Prescrição interna não encontrada")
    if prescription.patient_reference != payload.patient_reference:
        raise HTTPException(status_code=409, detail="A prescrição não pertence ao paciente selecionado")
    if prescription.status == "cancelled":
        raise HTTPException(status_code=409, detail="A prescrição foi cancelada")
    if not payload.fulfill and prescription.status != "pending":
        raise HTTPException(status_code=409, detail="A prescrição já foi atendida")
    if payload.fulfill and prescription.status == "pending":
        prescription.status = "fulfilled"
        prescription.updated_at = datetime.now(UTC)
        db.commit()
        db.refresh(prescription)
    return serialize_physician_prescription(prescription)


@app.post("/api/v1/nursing/medication-administrations", status_code=201)
def create_medication_administration(
    payload: MedicationAdministrationPayload,
    principal: Annotated[DemoPrincipal, Depends(NURSING_ROLE)],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, object]:
    dispensation = resolve_medication_dispensation(payload.dispensation_id)
    if dispensation["patient_reference"] != payload.patient_reference:
        raise HTTPException(status_code=409, detail="A dispensação não pertence ao paciente selecionado")
    patient = db.scalar(
        select(Patient).where(Patient.reference == payload.patient_reference).with_for_update()
    )
    if patient is None or not patient.active:
        raise HTTPException(status_code=404, detail="Paciente não encontrado ou inativo")
    try:
        dose = Decimal(payload.dose.replace(",", "."))
        dispensed_quantity = Decimal(dispensation["quantity"].replace(",", "."))
    except (InvalidOperation, KeyError) as exc:
        raise HTTPException(status_code=503, detail="Resposta inválida do serviço de Farmácia") from exc
    if not dose.is_finite() or dose <= 0:
        raise HTTPException(status_code=422, detail="Informe uma dose válida e maior que zero")
    if not dispensed_quantity.is_finite() or dispensed_quantity <= 0:
        raise HTTPException(status_code=502, detail="A Farmácia retornou uma quantidade de dispensação inválida")
    previous_records = db.scalars(
        select(MedicationAdministration).where(
            MedicationAdministration.dispensation_id == payload.dispensation_id
        )
    ).all()
    administered_quantity = sum(
        (Decimal(record.dose.replace(",", ".")) for record in previous_records if record.status == "administered"),
        Decimal(0),
    )
    remaining_quantity = dispensed_quantity - administered_quantity
    if remaining_quantity <= 0:
        raise HTTPException(status_code=409, detail="A quantidade dispensada já foi totalmente administrada")
    if dose > remaining_quantity:
        raise HTTPException(status_code=409, detail="A dose informada excede a quantidade ainda disponível da dispensação")
    if payload.status != "administered" and len(payload.reason) < 3:
        raise HTTPException(status_code=422, detail="Informe o motivo da recusa ou suspensão")
    record = MedicationAdministration(
        dispensation_id=dispensation["id"],
        patient_reference=patient.reference,
        medication_name=dispensation["medication_name"],
        dose=format(dose.normalize(), "f"),
        unit=dispensation["unit"],
        status=payload.status,
        reason=payload.reason,
        actor_id=principal.user_id,
        actor_name=principal.actor_name,
        administered_at=datetime.now(UTC),
    )
    db.add(record)
    db.flush()
    emit_audit_event(
        principal, "nursing", "medication_administration_recorded",
        str(record.id), db=db,
    )
    db.commit()
    db.refresh(record)
    return serialize_medication_administration(record)


def serialize_emergency_arrival(
    arrival: EmergencyArrival,
    allergies_status: str = "unknown",
    *,
    include_allergy_details: bool = False,
) -> dict[str, object]:
    serialized: dict[str, object] = {
        "id": arrival.id,
        "patient_reference": arrival.patient_reference,
        "patient_name": arrival.patient_name,
        "allergies_status": allergies_status,
        "allergy_report_status": arrival.allergy_report_status,
        "arrival_mode": arrival.arrival_mode,
        "reason": arrival.reason,
        "status": arrival.status,
        "clinical_priority": arrival.clinical_priority,
        "queue_type": arrival.queue_type,
        "clinical_priority_updated_by": arrival.clinical_priority_updated_by,
        "clinical_priority_updated_at": arrival.clinical_priority_updated_at.isoformat() if arrival.clinical_priority_updated_at else None,
        "clinical_priority_reason": arrival.clinical_priority_reason,
        "created_by": arrival.created_by,
        "updated_by": arrival.updated_by,
        "created_at": arrival.created_at.isoformat(),
        "updated_at": arrival.updated_at.isoformat(),
    }
    if include_allergy_details:
        serialized["reported_allergies"] = arrival.reported_allergies
    return serialized


def snapshot_outpatient_patient(patient: Patient) -> dict[str, str]:
    birth_date = patient.birth_date.isoformat() if patient.birth_date else ""
    age = ""
    if patient.birth_date:
        today = datetime.now(UTC).date()
        age = str(
            today.year
            - patient.birth_date.year
            - ((today.month, today.day) < (patient.birth_date.month, patient.birth_date.day))
        )
    return {
        "reference": patient.reference,
        "name": patient.name,
        "mother_name": patient.mother_name,
        "birth_date": birth_date,
        "age": age,
        "sex": patient.sex,
        "cpf": patient.cpf,
        "sus_card": patient.sus_card,
        "same_number": patient.same_number,
        "health_plan": patient.health_plan,
        "address": patient.address,
        "address_number": patient.address_number,
        "address_complement": patient.address_complement,
        "neighborhood": patient.neighborhood,
        "city": patient.city,
        "state": patient.state,
        "postal_code": patient.postal_code,
        "phone": patient.phone,
        "email": patient.email,
        "photo_data": patient.photo_data,
    }


def serialize_reception_appointment(
    appointment: ReceptionAppointment, patient_name: str
) -> dict[str, object]:
    starts_at = appointment.starts_at
    ends_at = appointment.ends_at
    if starts_at.tzinfo is None:
        starts_at = starts_at.replace(tzinfo=UTC)
    if ends_at.tzinfo is None:
        ends_at = ends_at.replace(tzinfo=UTC)
    return {
        "id": appointment.id,
        "patient_reference": appointment.patient_reference,
        "patient_name": patient_name,
        "appointment_type": appointment.appointment_type,
        "professional_name": appointment.professional_name,
        "location": appointment.location,
        "purpose": appointment.purpose,
        "starts_at": starts_at.isoformat(),
        "ends_at": ends_at.isoformat(),
        "status": appointment.status,
        "created_by_name": appointment.created_by_name,
        "updated_by_name": appointment.updated_by_name,
        "created_at": appointment.created_at.isoformat(),
        "updated_at": appointment.updated_at.isoformat(),
        "arrived_at": appointment.arrived_at.isoformat() if appointment.arrived_at else None,
    }


def serialize_outpatient_encounter(encounter: OutpatientEncounter) -> dict[str, object]:
    return {
        "id": encounter.id,
        "patient_reference": encounter.patient_reference,
        "patient_snapshot": encounter.patient_snapshot,
        "encounter_type": encounter.encounter_type,
        "physician_name": encounter.physician_name,
        "examination": encounter.examination,
        "activity_rows": encounter.activity_rows,
        "group_name": encounter.group_name,
        "programs": encounter.programs,
        "diagnostic_hypothesis": encounter.diagnostic_hypothesis,
        "antibiotic_prescription": encounter.antibiotic_prescription,
        "referral": encounter.referral,
        "created_by": encounter.created_by,
        "created_at": encounter.created_at.isoformat(),
    }


def serialize_patient_flow_event(event: PatientFlowEvent) -> dict[str, object]:
    return {
        "id": event.id,
        "patient_reference": event.patient_reference,
        "event_type": event.event_type,
        "previous_room": event.previous_room,
        "previous_bed": event.previous_bed,
        "next_room": event.next_room,
        "next_bed": event.next_bed,
        "reason": event.reason,
        "summary": event.summary,
        "actor_name": event.actor_name,
        "occurred_at": event.occurred_at.isoformat(),
    }


def serialize_patient_allergy_history(record: PatientAllergyHistory) -> dict[str, object]:
    return {
        "id": record.id,
        "previous_status": record.previous_status,
        "previous_details": record.previous_details,
        "new_status": record.new_status,
        "new_details": record.new_details,
        "reason": record.reason,
        "actor_name": record.actor_name,
        "recorded_at": record.recorded_at.isoformat(),
    }


def serialize_clinical_risk(risk: ClinicalRisk) -> dict[str, object]:
    return {
        "id": risk.id,
        "patient_reference": risk.patient_reference,
        "risk_type": risk.risk_type,
        "description": risk.description,
        "severity": risk.severity,
        "status": risk.status,
        "reason": risk.reason,
        "actor_name": risk.actor_name,
        "created_at": risk.created_at.isoformat(),
        "resolved_at": risk.resolved_at.isoformat() if risk.resolved_at else None,
        "resolved_by": risk.resolved_by,
        "resolution_reason": risk.resolution_reason,
    }


def serialize_medication_administration(record: MedicationAdministration) -> dict[str, object]:
    return {
        "id": record.id,
        "dispensation_id": record.dispensation_id,
        "patient_reference": record.patient_reference,
        "medication_name": record.medication_name,
        "dose": record.dose,
        "unit": record.unit,
        "status": record.status,
        "reason": record.reason,
        "actor_name": record.actor_name,
        "administered_at": record.administered_at.isoformat(),
    }


def serialize_scheduled_medication_administration(
    record: ScheduledMedicationAdministration,
) -> dict[str, object]:
    return {
        "id": record.id,
        "prescription_reference": record.prescription_reference,
        "patient_reference": record.patient_reference,
        "scheduled_date": record.scheduled_date.isoformat(),
        "scheduled_time": record.scheduled_time,
        "status": record.status,
        "reason": record.reason,
        "actor_name": record.actor_name,
        "recorded_at": record.recorded_at.isoformat(),
    }


def serialize_physician_profile(profile: PhysicianProfile) -> dict[str, object]:
    return {
        "user_id": profile.user_id,
        "name": profile.name,
        "crm": profile.crm,
        "crm_state": profile.crm_state,
        "updated_at": profile.updated_at.isoformat(),
    }


def serialize_physician_prescription(prescription: PhysicianPrescription) -> dict[str, object]:
    return {
        "id": prescription.id,
        "patient_reference": prescription.patient_reference,
        "medication_name": prescription.medication_name,
        "active_ingredient": prescription.active_ingredient,
        "presentation": prescription.presentation,
        "dose": prescription.dose,
        "route": prescription.route,
        "frequency": prescription.frequency,
        "administration_times": prescription.administration_times or [],
        "duration": prescription.duration,
        "quantity": prescription.quantity,
        "unit": prescription.unit,
        "instructions": prescription.instructions,
        "is_controlled": prescription.is_controlled,
        "prescriber_id": prescription.prescriber_id,
        "prescriber_name": prescription.prescriber_name,
        "crm": prescription.crm,
        "crm_state": prescription.crm_state,
        "status": prescription.status,
        "created_at": prescription.created_at.isoformat(),
        "updated_at": prescription.updated_at.isoformat(),
    }


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


@app.get("/api/v1/nursing/patients/flow-events")
def list_patient_flow_events(
    principal: Annotated[DemoPrincipal, PATIENT_HISTORY_ACCESS],
    db: Annotated[Session, Depends(get_nursing_db)],
    patient_reference: str | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> dict[str, object]:
    query = select(PatientFlowEvent)
    count_query = select(func.count(PatientFlowEvent.id))
    if patient_reference:
        query = query.where(PatientFlowEvent.patient_reference == patient_reference)
        count_query = count_query.where(PatientFlowEvent.patient_reference == patient_reference)
    events = db.scalars(
        query.order_by(PatientFlowEvent.occurred_at.desc()).offset(offset).limit(limit)
    ).all()
    total = db.scalar(count_query) or 0
    emit_audit_event(principal, "patients", "patient_flow_history_read", patient_reference or "all")
    return {"events": [serialize_patient_flow_event(event) for event in events], "total": total}


@app.post("/api/v1/nursing/patients/{patient_reference}/transfer", status_code=201)
def transfer_patient(
    patient_reference: str,
    payload: PatientTransferPayload,
    principal: Annotated[DemoPrincipal, Depends(require_demo_role("nursing", "management"))],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, object]:
    patient = db.get(Patient, patient_reference)
    if patient is None or not patient.active:
        raise HTTPException(status_code=404, detail="Paciente não encontrado ou não está internado")
    if not patient.room or not patient.bed:
        raise HTTPException(status_code=409, detail="O paciente não possui leito de internação para transferir")
    bed, _ = _available_hospital_bed(
        db, payload.bed_id, exclude_patient_reference=patient.reference
    )
    current_assignment = _active_assignment_for_patient(db, patient.reference)
    if current_assignment and bed.id == current_assignment.bed_id:
        raise HTTPException(status_code=409, detail="O paciente já está neste leito")
    now = datetime.now(UTC)
    event = PatientFlowEvent(
        patient_reference=patient.reference,
        event_type="transfer",
        previous_room=patient.room,
        previous_bed=patient.bed,
        next_room=bed.room,
        next_bed=bed.label,
        reason=payload.reason,
        actor_id=principal.user_id,
        actor_name=principal.actor_name,
        occurred_at=now,
    )
    db.add(event)
    _assign_patient_to_bed(db, patient, bed, principal, now)
    emit_audit_event(
        principal, "nursing", "patient_transferred", patient.reference, db=db
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="O leito foi ocupado por outra operação; atualize o mapa") from exc
    db.refresh(event)
    return {"patient": serialize_patient(patient, principal=principal), "event": serialize_patient_flow_event(event)}


@app.post("/api/v1/nursing/patients/{patient_reference}/discharge", status_code=201)
def discharge_patient(
    patient_reference: str,
    payload: PatientDischargePayload,
    principal: Annotated[DemoPrincipal, Depends(require_demo_role("nursing", "management"))],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, object]:
    patient = db.get(Patient, patient_reference)
    if patient is None or not patient.active:
        raise HTTPException(status_code=404, detail="Paciente não encontrado ou já recebeu alta")
    if not patient.room or not patient.bed:
        raise HTTPException(status_code=409, detail="O paciente não possui leito de internação para receber alta")
    now = datetime.now(UTC)
    event = PatientFlowEvent(
        patient_reference=patient.reference,
        event_type="discharge",
        previous_room=patient.room,
        previous_bed=patient.bed,
        reason=payload.reason,
        summary=payload.summary,
        actor_id=principal.user_id,
        actor_name=principal.actor_name,
        occurred_at=now,
    )
    db.add(event)
    _release_patient_bed(db, patient, principal, now)
    patient.active = False
    patient.room = ""
    patient.bed = ""
    patient.updated_at = now
    patient.updated_by = principal.actor_name
    emit_audit_event(
        principal, "nursing", "patient_discharged", patient.reference, db=db
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Não foi possível liberar o leito; atualize o mapa e tente novamente") from exc
    db.refresh(event)
    return {"patient": serialize_patient(patient, principal=principal), "event": serialize_patient_flow_event(event)}


@app.get("/api/v1/nursing/clinical-risks")
def list_clinical_risks(
    principal: Annotated[DemoPrincipal, CLINICAL_RISK_ACCESS],
    db: Annotated[Session, Depends(get_nursing_db)],
    include_inactive: bool = False,
) -> dict[str, list[dict[str, object]]]:
    patients_query = select(Patient).where(
        Patient.allergies_status != "none_known",
        Patient.deleted_at.is_(None),
    )
    if not include_inactive:
        patients_query = patients_query.where(Patient.active.is_(True))
    patients = db.scalars(patients_query.order_by(Patient.name)).all()
    risk_query = select(ClinicalRisk).where(ClinicalRisk.status == "active")
    if not include_inactive:
        risk_query = risk_query.join(Patient, ClinicalRisk.patient_reference == Patient.reference).where(Patient.active.is_(True))
    risks = db.scalars(risk_query.order_by(ClinicalRisk.created_at.desc())).all()
    allergies = [
        {
            "id": f"allergy-{patient.reference}",
            "patient_reference": patient.reference,
            "patient_name": patient.name,
            "room": patient.room,
            "bed": patient.bed,
            "risk_type": "allergy",
            "description": patient.allergies if patient.allergies_status == "known" else "Alergias não verificadas.",
            "severity": "high" if patient.allergies_status == "known" else "unspecified",
            "status": "active",
            "created_at": patient.updated_at.isoformat() if patient.updated_at else None,
        }
        for patient in patients
    ]
    risk_patient_refs = {risk.patient_reference for risk in risks}
    patients_by_reference = {
        patient.reference: patient
        for patient in db.scalars(select(Patient).where(Patient.reference.in_(risk_patient_refs))).all()
    } if risk_patient_refs else {}
    contraindications = [
        {
            **serialize_clinical_risk(risk),
            "patient_name": patients_by_reference.get(risk.patient_reference).name if risk.patient_reference in patients_by_reference else "Paciente",
            "room": patients_by_reference.get(risk.patient_reference).room if risk.patient_reference in patients_by_reference else "",
            "bed": patients_by_reference.get(risk.patient_reference).bed if risk.patient_reference in patients_by_reference else "",
        }
        for risk in risks
    ]
    emit_audit_event(principal, "nursing", "clinical_risk_center_read", "clinical_risks")
    return {"risks": allergies + contraindications}


@app.get("/api/v1/nursing/safety-incidents")
def list_patient_safety_incidents(
    principal: Annotated[DemoPrincipal, Depends(require_demo_role("nursing", "management"))],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, list[dict[str, object]]]:
    incidents = db.scalars(
        select(PatientSafetyIncident).order_by(
            PatientSafetyIncident.occurred_at.desc(),
            PatientSafetyIncident.created_at.desc(),
        )
    ).all()
    emit_audit_event(principal, "nursing", "patient_safety_incidents_read", "all")
    return {"incidents": [_serialize_patient_safety_incident(item) for item in incidents]}


@app.post("/api/v1/nursing/safety-incidents", status_code=201)
def create_patient_safety_incident(
    payload: PatientSafetyIncidentPayload,
    principal: Annotated[DemoPrincipal, Depends(require_demo_role("nursing", "management"))],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, object]:
    if payload.patient_reference and db.get(Patient, payload.patient_reference) is None:
        raise HTTPException(status_code=404, detail="Paciente não encontrado")
    now = datetime.now(UTC)
    incident = PatientSafetyIncident(
        id=str(uuid.uuid4()),
        **payload.model_dump(),
        status="open",
        investigation="",
        corrective_action="",
        reported_by=principal.actor_name,
        updated_by=principal.actor_name,
        created_at=now,
        updated_at=now,
    )
    db.add(incident)
    emit_audit_event(principal, "nursing", "patient_safety_incident_created", incident.id, db=db)
    db.commit()
    db.refresh(incident)
    return _serialize_patient_safety_incident(incident)


@app.patch("/api/v1/nursing/safety-incidents/{incident_id}")
def update_patient_safety_incident(
    incident_id: str,
    payload: PatientSafetyIncidentUpdatePayload,
    principal: Annotated[DemoPrincipal, Depends(require_demo_role("nursing", "management"))],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, object]:
    incident = db.get(PatientSafetyIncident, incident_id)
    if incident is None:
        raise HTTPException(status_code=404, detail="Incidente não encontrado")
    if incident.status == "closed":
        raise HTTPException(status_code=409, detail="Incidentes encerrados não podem ser alterados")
    if payload.status in {"action_required", "closed"} and len(payload.investigation) < 5:
        raise HTTPException(status_code=422, detail="Registre a investigação antes de avançar")
    incident.status = payload.status
    incident.investigation = payload.investigation
    incident.corrective_action = payload.corrective_action
    incident.updated_by = principal.actor_name
    incident.updated_at = datetime.now(UTC)
    emit_audit_event(principal, "nursing", "patient_safety_incident_updated", incident.id, db=db)
    db.commit()
    db.refresh(incident)
    return _serialize_patient_safety_incident(incident)


@app.get("/api/v1/nursing/institutional-documents")
def list_institutional_documents(
    principal: Annotated[DemoPrincipal, Depends(require_demo_role("management"))],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, list[dict[str, object]]]:
    documents = db.scalars(
        select(InstitutionalDocument).order_by(
            InstitutionalDocument.updated_at.desc(),
            InstitutionalDocument.title,
        )
    ).all()
    emit_audit_event(principal, "management", "institutional_documents_read", "all")
    return {"documents": [_serialize_institutional_document(item) for item in documents]}


@app.post("/api/v1/nursing/institutional-documents", status_code=201)
def create_institutional_document(
    payload: InstitutionalDocumentPayload,
    principal: Annotated[DemoPrincipal, Depends(require_demo_role("management"))],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, object]:
    now = datetime.now(UTC)
    document = InstitutionalDocument(
        id=str(uuid.uuid4()),
        **payload.model_dump(),
        status="draft",
        created_by=principal.actor_name,
        approved_by="",
        approved_at=None,
        created_at=now,
        updated_at=now,
    )
    db.add(document)
    emit_audit_event(principal, "management", "institutional_document_created", document.id, db=db)
    db.commit()
    db.refresh(document)
    return _serialize_institutional_document(document)


@app.patch("/api/v1/nursing/institutional-documents/{document_id}")
def update_institutional_document_status(
    document_id: str,
    payload: InstitutionalDocumentStatusPayload,
    principal: Annotated[DemoPrincipal, Depends(require_demo_role("management"))],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, object]:
    document = db.get(InstitutionalDocument, document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="Documento institucional não encontrado")
    transitions = {
        "draft": {"in_review", "archived"},
        "in_review": {"approved", "archived"},
        "approved": {"archived"},
    }
    if payload.status not in transitions.get(document.status, set()):
        raise HTTPException(status_code=409, detail="Transição de aprovação inválida")
    now = datetime.now(UTC)
    document.status = payload.status
    if payload.status == "approved":
        document.approved_by = principal.actor_name
        document.approved_at = now
    document.updated_at = now
    emit_audit_event(principal, "management", "institutional_document_status_updated", document.id, db=db)
    db.commit()
    db.refresh(document)
    return _serialize_institutional_document(document)


def _serialize_patient_safety_incident(incident: PatientSafetyIncident) -> dict[str, object]:
    return {
        "id": incident.id,
        "incident_type": incident.incident_type,
        "severity": incident.severity,
        "occurred_at": incident.occurred_at.isoformat(),
        "unit": incident.unit,
        "location": incident.location,
        "patient_reference": incident.patient_reference,
        "description": incident.description,
        "status": incident.status,
        "investigation": incident.investigation,
        "corrective_action": incident.corrective_action,
        "reported_by": incident.reported_by,
        "updated_by": incident.updated_by,
        "created_at": incident.created_at.isoformat(),
        "updated_at": incident.updated_at.isoformat(),
    }


def _serialize_institutional_document(document: InstitutionalDocument) -> dict[str, object]:
    return {
        "id": document.id,
        "title": document.title,
        "document_type": document.document_type,
        "version": document.version,
        "content": document.content,
        "status": document.status,
        "valid_until": document.valid_until.isoformat() if document.valid_until else None,
        "created_by": document.created_by,
        "approved_by": document.approved_by,
        "approved_at": document.approved_at.isoformat() if document.approved_at else None,
        "created_at": document.created_at.isoformat(),
        "updated_at": document.updated_at.isoformat(),
    }


@app.get("/api/v1/nursing/management/dashboard")
def get_management_dashboard(
    principal: Annotated[DemoPrincipal, Depends(require_demo_role("management"))],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, object]:
    now = datetime.now(UTC)
    hospital_timezone = ZoneInfo("America/Sao_Paulo")
    hospital_today = datetime.now(hospital_timezone).date()
    local_day_start = datetime.combine(hospital_today, time.min, tzinfo=hospital_timezone)
    day_start = local_day_start.astimezone(UTC)
    next_day = (local_day_start + timedelta(days=1)).astimezone(UTC)
    document_expiry_limit = hospital_today + timedelta(days=30)
    active_patients = Patient.active.is_(True)
    bed_capacity = _bed_capacity(db)
    summary = {
        "active_patients": db.scalar(select(func.count(Patient.reference)).where(active_patients)) or 0,
        "occupied_beds": db.scalar(
            select(func.count(Patient.reference)).where(
                active_patients,
                Patient.room != "",
                Patient.bed != "",
            )
        ) or 0,
        "patients_without_allergy_confirmation": db.scalar(
            select(func.count(Patient.reference)).where(
                active_patients,
                Patient.allergies_status == "unknown",
            )
        ) or 0,
        "patients_with_known_allergies": db.scalar(
            select(func.count(Patient.reference)).where(
                active_patients,
                Patient.allergies_status == "known",
            )
        ) or 0,
        "active_contraindications": db.scalar(
            select(func.count(ClinicalRisk.id)).where(ClinicalRisk.status == "active")
        ) or 0,
        "open_emergency_arrivals": db.scalar(
            select(func.count(EmergencyArrival.id)).where(
                EmergencyArrival.status.in_(("waiting", "called", "in_service"))
            )
        ) or 0,
        "emergency_arrivals_today": db.scalar(
            select(func.count(EmergencyArrival.id)).where(
                EmergencyArrival.created_at >= day_start,
                EmergencyArrival.created_at < next_day,
            )
        ) or 0,
        "vital_records_today": db.scalar(
            select(func.count(VitalRecord.id)).where(
                VitalRecord.recorded_at >= day_start,
                VitalRecord.recorded_at < next_day,
                VitalRecord.voided_at.is_(None),
            )
        ) or 0,
        "patient_transfers_today": db.scalar(
            select(func.count(PatientFlowEvent.id)).where(
                PatientFlowEvent.event_type == "transfer",
                PatientFlowEvent.occurred_at >= day_start,
                PatientFlowEvent.occurred_at < next_day,
            )
        ) or 0,
        "patient_admissions_today": db.scalar(
            select(func.count(PatientFlowEvent.id)).where(
                PatientFlowEvent.event_type == "admission",
                PatientFlowEvent.occurred_at >= day_start,
                PatientFlowEvent.occurred_at < next_day,
            )
        ) or 0,
        "patient_discharges_today": db.scalar(
            select(func.count(PatientFlowEvent.id)).where(
                PatientFlowEvent.event_type == "discharge",
                PatientFlowEvent.occurred_at >= day_start,
                PatientFlowEvent.occurred_at < next_day,
            )
        ) or 0,
        "appointments_today": db.scalar(
            select(func.count(ReceptionAppointment.id)).where(
                ReceptionAppointment.starts_at >= day_start,
                ReceptionAppointment.starts_at < next_day,
            )
        ) or 0,
        "appointments_pending_today": db.scalar(
            select(func.count(ReceptionAppointment.id)).where(
                ReceptionAppointment.starts_at >= day_start,
                ReceptionAppointment.starts_at < next_day,
                ReceptionAppointment.status.in_(("scheduled", "confirmed")),
            )
        ) or 0,
        "appointments_no_show_today": db.scalar(
            select(func.count(ReceptionAppointment.id)).where(
                ReceptionAppointment.starts_at >= day_start,
                ReceptionAppointment.starts_at < next_day,
                ReceptionAppointment.status == "no_show",
            )
        ) or 0,
        "beds_in_cleaning": db.scalar(
            select(func.count(HospitalBed.id)).where(
                HospitalBed.active.is_(True),
                HospitalBed.status == "cleaning",
            )
        ) or 0,
        "beds_in_maintenance": db.scalar(
            select(func.count(HospitalBed.id)).where(
                HospitalBed.active.is_(True),
                HospitalBed.status == "maintenance",
            )
        ) or 0,
        "open_safety_incidents": db.scalar(
            select(func.count(PatientSafetyIncident.id)).where(
                PatientSafetyIncident.status != "closed",
            )
        ) or 0,
        "serious_open_safety_incidents": db.scalar(
            select(func.count(PatientSafetyIncident.id)).where(
                PatientSafetyIncident.status != "closed",
                PatientSafetyIncident.severity.in_(("severe", "critical")),
            )
        ) or 0,
        "documents_pending_review": db.scalar(
            select(func.count(InstitutionalDocument.id)).where(
                InstitutionalDocument.status == "in_review",
            )
        ) or 0,
        "approved_documents_expired": db.scalar(
            select(func.count(InstitutionalDocument.id)).where(
                InstitutionalDocument.status == "approved",
                InstitutionalDocument.valid_until < hospital_today,
            )
        ) or 0,
        "approved_documents_expiring_soon": db.scalar(
            select(func.count(InstitutionalDocument.id)).where(
                InstitutionalDocument.status == "approved",
                InstitutionalDocument.valid_until >= hospital_today,
                InstitutionalDocument.valid_until <= document_expiry_limit,
            )
        ) or 0,
        "physical_beds": bed_capacity["total_beds"],
        "mapped_occupied_beds": bed_capacity["occupied_beds"],
        "operational_beds": bed_capacity["operational_beds"],
        "available_beds": bed_capacity["available_beds"],
        "unreconciled_legacy_patients": bed_capacity["unreconciled_legacy_patients"],
        "occupancy_percent": bed_capacity["occupancy_percent"],
        "updated_at": now.isoformat(),
    }
    emit_audit_event(principal, "management", "executive_dashboard_read", "hospital_summary")
    return summary


@app.get("/api/v1/nursing/patients/{patient_reference}/allergy-history")
def list_patient_allergy_history(
    patient_reference: str,
    principal: Annotated[DemoPrincipal, CLINICAL_RISK_ACCESS],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, list[dict[str, object]]]:
    if db.get(Patient, patient_reference) is None:
        raise HTTPException(status_code=404, detail="Paciente não encontrado")
    records = db.scalars(
        select(PatientAllergyHistory)
        .where(PatientAllergyHistory.patient_reference == patient_reference)
        .order_by(PatientAllergyHistory.recorded_at.desc())
        .limit(100)
    ).all()
    emit_audit_event(principal, "nursing", "patient_allergy_history_read", patient_reference)
    return {"events": [serialize_patient_allergy_history(record) for record in records]}


@app.post("/api/v1/nursing/patients/{patient_reference}/clinical-risks", status_code=201)
def create_clinical_risk(
    patient_reference: str,
    payload: ClinicalRiskPayload,
    principal: Annotated[DemoPrincipal, Depends(NURSING_ROLE)],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, object]:
    patient = db.get(Patient, patient_reference)
    if patient is None or not patient.active:
        raise HTTPException(status_code=404, detail="Paciente não encontrado ou inativo")
    risk = ClinicalRisk(
        patient_reference=patient.reference,
        risk_type="contraindication",
        description=payload.description,
        severity=payload.severity,
        reason=payload.reason,
        actor_id=principal.user_id,
        actor_name=principal.actor_name,
        created_at=datetime.now(UTC),
    )
    db.add(risk)
    db.flush()
    emit_audit_event(
        principal, "nursing", "clinical_risk_recorded", str(risk.id), db=db
    )
    db.commit()
    db.refresh(risk)
    return serialize_clinical_risk(risk)


@app.patch("/api/v1/nursing/patients/{patient_reference}/elopement-risk")
def update_patient_elopement_risk(
    patient_reference: str,
    payload: ElopementRiskPayload,
    principal: Annotated[DemoPrincipal, Depends(NURSING_ROLE)],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, object]:
    patient = db.get(Patient, patient_reference)
    if patient is None or not patient.active:
        raise HTTPException(status_code=404, detail="Paciente ativo não encontrado")
    patient.elopement_risk = payload.at_risk
    patient.updated_at = datetime.now(UTC)
    patient.updated_by = principal.actor_name
    open_round = db.scalar(
        select(NursingHourlyRound).where(NursingHourlyRound.status == "open")
    )
    if open_round is not None:
        round_patient = db.scalar(
            select(NursingHourlyRoundPatient).where(
                NursingHourlyRoundPatient.round_id == open_round.id,
                NursingHourlyRoundPatient.patient_reference == patient.reference,
            )
        )
        if round_patient is not None:
            round_patient.elopement_risk = payload.at_risk
    emit_audit_event(
        principal,
        "nursing",
        "patient_elopement_risk_updated",
        patient.reference,
        db=db,
    )
    db.commit()
    return {
        "patient_reference": patient.reference,
        "elopement_risk": patient.elopement_risk,
        "updated_by": patient.updated_by,
        "updated_at": patient.updated_at.isoformat(),
    }


@app.patch("/api/v1/nursing/clinical-risks/{risk_id}/resolve")
def resolve_clinical_risk(
    risk_id: int,
    payload: ClinicalRiskResolutionPayload,
    principal: Annotated[DemoPrincipal, Depends(NURSING_ROLE)],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, object]:
    risk = db.get(ClinicalRisk, risk_id)
    if risk is None:
        raise HTTPException(status_code=404, detail="Risco clínico não encontrado")
    if risk.status != "active":
        raise HTTPException(status_code=409, detail="Este risco já foi resolvido")
    risk.status = "resolved"
    risk.resolved_at = datetime.now(UTC)
    risk.resolved_by = principal.actor_name
    risk.resolution_reason = payload.reason
    emit_audit_event(
        principal, "nursing", "clinical_risk_resolved", str(risk.id), db=db
    )
    db.commit()
    db.refresh(risk)
    return serialize_clinical_risk(risk)


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
    principal: Annotated[DemoPrincipal, PATIENT_DELETE_ACCESS],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, object]:
    patient = db.get(Patient, patient_reference)
    if patient is None:
        raise HTTPException(status_code=404, detail="Paciente não encontrado")
    if _active_assignment_for_patient(db, patient.reference):
        raise HTTPException(
            status_code=409,
            detail="Registre a alta antes de arquivar um paciente vinculado a leito",
        )
    patient.active = False
    patient.deleted_at = datetime.now(UTC)
    patient.deleted_by = principal.actor_name
    patient.deletion_reason = payload.reason.strip()
    patient.updated_at = datetime.now(UTC)
    patient.updated_by = principal.actor_name
    emit_audit_event(
        principal, "patients", "patient_archived", patient.reference, db=db
    )
    db.commit()
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


def create_patient_record(
    db: Session,
    principal: DemoPrincipal,
    payload: PatientPayload,
) -> Patient:
    selected_bed: tuple[HospitalBed, HospitalUnit] | None = None
    if payload.bed_id:
        selected_bed = _available_hospital_bed(db, payload.bed_id)
    if payload.cpf and db.scalar(select(Patient.reference).where(Patient.cpf == payload.cpf)):
        raise HTTPException(status_code=409, detail="Já existe um paciente cadastrado com este CPF")
    if payload.sus_card and db.scalar(select(Patient.reference).where(Patient.sus_card == payload.sus_card)):
        raise HTTPException(status_code=409, detail="Já existe um paciente cadastrado com este Cartão SUS")
    if selected_bed is None and payload.room.strip() and payload.bed.strip() and db.scalar(
        select(Patient.reference).where(
            Patient.active.is_(True),
            Patient.room == payload.room.strip(),
            Patient.bed == payload.bed.strip(),
        )
    ):
        raise HTTPException(status_code=409, detail="Este quarto e leito já estão ocupados")
    now = datetime.now(UTC)
    patient_data = payload.model_dump(exclude={"bed_id", "treatment_track", "elopement_risk"})
    if selected_bed:
        bed, _ = selected_bed
        patient_data["room"] = bed.room
        patient_data["bed"] = bed.label
    patient = Patient(
        reference=str(uuid.uuid4()),
        **patient_data,
        treatment_track=payload.treatment_track or "unclassified",
        elopement_risk=True,
        created_at=now,
        updated_at=now,
        updated_by=principal.actor_name,
    )
    db.add(patient)
    db.flush()
    if patient.allergies_status != "unknown":
        record_patient_allergy_change(
            db,
            principal,
            patient,
            patient.allergies_status,
            patient.allergies,
            "Registro inicial no cadastro do paciente",
            previous_status="unknown",
            previous_details="",
        )
    emit_audit_event(principal, "patients", "patient_created", patient.reference, db=db)
    return patient


@app.post("/api/v1/nursing/patients", status_code=201)
def create_patient(
    payload: PatientPayload,
    principal: Annotated[DemoPrincipal, PATIENT_ACCESS],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, object]:
    patient = create_patient_record(db, principal, payload)
    db.commit()
    db.refresh(patient)
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
    if patient.active and payload.room.strip() and payload.bed.strip() and db.scalar(select(Patient.reference).where(Patient.active.is_(True), Patient.room == payload.room.strip(), Patient.bed == payload.bed.strip(), Patient.reference != patient_reference)):
        raise HTTPException(status_code=409, detail="Este quarto e leito já estão ocupados")
    if _active_assignment_for_patient(db, patient.reference) and (
        patient.room != payload.room.strip() or patient.bed != payload.bed.strip()
    ):
        raise HTTPException(
            status_code=409,
            detail="Altere a localização pela rotina de transferência para manter o mapa de leitos consistente",
        )
    record_patient_allergy_change(
        db,
        principal,
        patient,
        payload.allergies_status,
        payload.allergies,
        "Atualização do cadastro do paciente",
    )
    for key, value in payload.model_dump(exclude_none=True, exclude={"bed_id"}).items():
        if key == "elopement_risk":
            continue
        setattr(patient, key, value)
    patient.updated_at = datetime.now(UTC)
    patient.updated_by = principal.actor_name
    emit_audit_event(
        principal, "patients", "patient_updated", patient.reference, db=db
    )
    db.commit()
    db.refresh(patient)
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
    if not active and _active_assignment_for_patient(db, patient.reference):
        raise HTTPException(status_code=409, detail="Registre a alta antes de inativar um paciente vinculado a leito")
    if active and not patient.active and patient.room and patient.bed and db.scalar(select(Patient.reference).where(
        Patient.active.is_(True), Patient.room == patient.room, Patient.bed == patient.bed,
    )):
        raise HTTPException(status_code=409, detail="O quarto e leito deste paciente já estão ocupados")
    patient.active = active
    patient.updated_at = datetime.now(UTC)
    patient.updated_by = principal.actor_name
    emit_audit_event(
        principal, "patients", "patient_status_changed", patient.reference, db=db
    )
    db.commit()
    db.refresh(patient)
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


@app.get("/api/v1/nursing/patients/{patient_reference}/vital-trends")
def list_patient_vital_trends(
    patient_reference: str,
    principal: Annotated[DemoPrincipal, PATIENT_HISTORY_ACCESS],
    db: Annotated[Session, Depends(get_nursing_db)],
    hours: VitalTrendPeriod = VitalTrendPeriod.ONE_DAY,
    from_date: date | None = None,
    to_date: date | None = None,
    from_at: datetime | None = None,
    to_at: datetime | None = None,
) -> dict[str, object]:
    if db.get(Patient, patient_reference) is None:
        raise HTTPException(status_code=404, detail="Paciente não encontrado")
    now = datetime.now(UTC)
    if (from_date is None) != (to_date is None):
        raise HTTPException(status_code=422, detail="Informe as duas datas para consultar um período personalizado")
    if (from_at or to_at) and (from_date or to_date):
        raise HTTPException(status_code=422, detail="Use datas ou data e hora, não ambos os formatos")
    if any(value and (value.tzinfo is None or value.utcoffset() is None) for value in (from_at, to_at)):
        raise HTTPException(status_code=422, detail="Informe data e hora com fuso horário")
    if from_at and to_at and to_at <= from_at:
        raise HTTPException(status_code=422, detail="A data e hora inicial devem ser anteriores à final")
    if from_date and to_date and from_date > to_date:
        raise HTTPException(status_code=422, detail="A data inicial deve ser anterior à data final")
    if from_date and from_date > now.date():
        raise HTTPException(status_code=422, detail="A data inicial não pode ser futura")
    if from_at and to_at:
        start = from_at.astimezone(UTC)
        end = min(to_at.astimezone(UTC), now)
        if start > now:
            raise HTTPException(status_code=422, detail="A data inicial não pode ser futura")
    elif from_date and to_date:
        start = datetime.combine(from_date, time.min, tzinfo=UTC)
        end = min(datetime.combine(to_date + timedelta(days=1), time.min, tzinfo=UTC) - timedelta(microseconds=1), now)
    else:
        start = now - timedelta(hours=int(hours))
        end = now
    period_hours = max(1, int((end - start).total_seconds() // 3600))
    measured_time = func.coalesce(VitalRecord.measured_at, VitalRecord.recorded_at)
    records = db.scalars(
        select(VitalRecord)
        .where(
            VitalRecord.patient_reference == patient_reference,
            VitalRecord.voided_at.is_(None),
            measured_time >= start,
            measured_time <= end,
        )
        .order_by(measured_time.asc(), VitalRecord.id.asc())
    ).all()
    emit_audit_event(principal, "nursing", "patient_vital_trends_read", patient_reference)
    return {
        "patient_reference": patient_reference,
        "hours": period_hours,
        "generated_at": now.isoformat(),
        "range_start": start.isoformat(),
        "range_end": end.isoformat(),
        "records": [serialize_record(record) for record in records],
        "total": len(records),
    }


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
    emit_audit_event(
        principal, "patients", "patient_observation_created", patient_reference, db=db
    )
    db.commit()
    db.refresh(row)
    return {"id": row.id, "attention_level": row.attention_level, "observation": row.observation, "treatment_status": row.treatment_status, "actor_name": row.actor_name, "created_at": row.created_at.isoformat()}


@app.get("/api/v1/management/patient-status")
def list_management_patient_status(
    principal: Annotated[DemoPrincipal, Depends(require_demo_role("management", "admin", "oversight"))],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, list[dict[str, object]]]:
    patients = db.scalars(
        select(Patient).where(Patient.deleted_at.is_(None)).order_by(Patient.active.desc(), Patient.room, Patient.bed)
    ).all()
    references = [patient.reference for patient in patients]
    latest: dict[str, PatientObservation] = {}
    if references:
        observations = db.scalars(
            select(PatientObservation)
            .where(PatientObservation.patient_reference.in_(references))
            .order_by(PatientObservation.created_at.desc(), PatientObservation.id.desc())
        ).all()
        for observation in observations:
            latest.setdefault(observation.patient_reference, observation)
    emit_audit_event(principal, "management", "patient_status_report_read", "all")
    return {
        "statuses": [
            {
                "patient_reference": patient.reference,
                "patient_name": patient.name,
                "room": patient.room,
                "bed": patient.bed,
                "active": patient.active,
                "elopement_risk": patient.elopement_risk,
                "attention_level": latest[patient.reference].attention_level if patient.reference in latest else None,
                "treatment_status": latest[patient.reference].treatment_status if patient.reference in latest else None,
                "observation": latest[patient.reference].observation if patient.reference in latest else "",
                "actor_name": latest[patient.reference].actor_name if patient.reference in latest else "",
                "updated_at": latest[patient.reference].created_at.isoformat() if patient.reference in latest else None,
            }
            for patient in patients
        ]
    }


def serialize_behavioral_observation(row: BehavioralObservation) -> dict[str, object]:
    return {
        "id": row.id,
        "patient_reference": row.patient_reference,
        "observation": row.observation,
        "context": row.context,
        "response": row.response,
        "status": row.status,
        "actor_name": row.actor_name,
        "created_at": row.created_at.isoformat(),
    }


def can_view_behavioral_history(principal: DemoPrincipal) -> bool:
    return principal.is_superuser or any(
        module in principal.modules
        and "consultar" in principal.permissions.get(module, [])
        for module in CLINICAL_HISTORY_MODULES
    ) or (
        "admin" in principal.modules
        and "administrar" in principal.permissions.get("admin", [])
    )


def can_update_behavioral_status(principal: DemoPrincipal) -> bool:
    return principal.is_superuser or any(
        module in principal.modules
        and "consultar" in principal.permissions.get(module, [])
        and "criar" in principal.permissions.get(module, [])
        for module in ("physician", "psychology")
    ) or (
        "admin" in principal.modules
        and "administrar" in principal.permissions.get("admin", [])
    )


def latest_behavioral_statuses(
    db: Session, patient_references: list[str]
) -> dict[str, BehavioralObservation]:
    if not patient_references:
        return {}
    rows = db.scalars(
        select(BehavioralObservation)
        .where(
            BehavioralObservation.patient_reference.in_(patient_references),
            BehavioralObservation.status.is_not(None),
        )
        .order_by(
            BehavioralObservation.created_at.desc(),
            BehavioralObservation.id.desc(),
        )
    ).all()
    latest: dict[str, BehavioralObservation] = {}
    for row in rows:
        latest.setdefault(row.patient_reference, row)
    return latest


@app.get("/api/v1/nursing/patients/{patient_reference}/behavioral-observations")
def list_behavioral_observations(
    patient_reference: str,
    principal: Annotated[DemoPrincipal, CLINICAL_HISTORY_ACCESS],
    db: Annotated[Session, Depends(get_nursing_db)],
    limit: Annotated[int, Query(ge=1, le=100)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> dict[str, object]:
    if not can_view_behavioral_history(principal):
        raise HTTPException(
            status_code=403,
            detail="Histórico comportamental disponível somente à equipe assistencial",
        )
    if db.get(Patient, patient_reference) is None:
        raise HTTPException(status_code=404, detail="Paciente não encontrado")
    query = select(BehavioralObservation).where(
        BehavioralObservation.patient_reference == patient_reference
    )
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = db.scalars(
        query.order_by(BehavioralObservation.created_at.desc(), BehavioralObservation.id.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    emit_audit_event(
        principal, "nursing", "patient_behavioral_observations_read", patient_reference
    )
    return {
        "observations": [serialize_behavioral_observation(row) for row in rows],
        "total": total,
    }


@app.get("/api/v1/nursing/behavioral-status")
def list_clinical_behavioral_status(
    principal: Annotated[DemoPrincipal, CLINICAL_HISTORY_ACCESS],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, list[dict[str, object]]]:
    if not can_view_behavioral_history(principal):
        raise HTTPException(
            status_code=403,
            detail="Sinalização comportamental disponível somente à equipe assistencial",
        )
    patients = db.scalars(
        select(Patient)
        .where(
            Patient.deleted_at.is_(None),
            Patient.active.is_(True),
            Patient.room != "",
            Patient.bed != "",
        )
        .order_by(Patient.room, Patient.bed, Patient.name)
    ).all()
    latest = latest_behavioral_statuses(
        db, [patient.reference for patient in patients]
    )
    emit_audit_event(
        principal, "nursing", "clinical_behavioral_status_read", "inpatients"
    )
    return {
        "statuses": [
            {
                "patient_reference": patient.reference,
                "patient_name": patient.name,
                "room": patient.room,
                "bed": patient.bed,
                "status": latest[patient.reference].status
                if patient.reference in latest
                else None,
                "updated_at": latest[patient.reference].created_at.isoformat()
                if patient.reference in latest
                else None,
            }
            for patient in patients
        ]
    }


@app.post(
    "/api/v1/nursing/patients/{patient_reference}/behavioral-observations",
    status_code=201,
)
def create_behavioral_observation(
    patient_reference: str,
    payload: BehavioralObservationPayload,
    principal: Annotated[DemoPrincipal, CLINICAL_HISTORY_ACCESS],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, object]:
    if not can_view_behavioral_history(principal):
        raise HTTPException(
            status_code=403,
            detail="Histórico comportamental disponível somente à equipe assistencial",
        )
    patient = db.get(Patient, patient_reference)
    if patient is None or patient.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Paciente não encontrado")
    row = BehavioralObservation(
        patient_reference=patient_reference,
        observation=payload.observation,
        context=payload.context,
        response=payload.response,
        status=payload.status,
        actor_id=principal.user_id,
        actor_name=principal.actor_name,
        created_at=datetime.now(UTC),
    )
    if payload.status is not None and not can_update_behavioral_status(principal):
        raise HTTPException(
            status_code=403,
            detail="Somente Médico, Psicologia/Psiquiatria ou Administração pode alterar o semáforo comportamental",
        )
    db.add(row)
    emit_audit_event(
        principal,
        "nursing",
        "patient_behavioral_observation_created",
        patient_reference,
        db=db,
    )
    db.commit()
    db.refresh(row)
    return serialize_behavioral_observation(row)


@app.get("/api/v1/management/behavioral-status")
def list_management_behavioral_status(
    principal: Annotated[
        DemoPrincipal,
        Depends(
            require_demo_role_or_superuser("management", "admin")
        ),
    ],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, list[dict[str, object]]]:
    patients = db.scalars(
        select(Patient)
        .where(
            Patient.deleted_at.is_(None),
            Patient.active.is_(True),
            Patient.room != "",
            Patient.bed != "",
        )
        .order_by(Patient.room, Patient.bed, Patient.name)
    ).all()
    latest = latest_behavioral_statuses(
        db, [patient.reference for patient in patients]
    )
    emit_audit_event(
        principal, "management", "behavioral_status_board_read", "inpatients"
    )
    return {
        "statuses": [
            {
                "patient_reference": patient.reference,
                "patient_name": patient.name,
                "room": patient.room,
                "bed": patient.bed,
                "status": latest[patient.reference].status
                if patient.reference in latest
                else None,
                "updated_at": latest[patient.reference].created_at.isoformat()
                if patient.reference in latest
                else None,
            }
            for patient in patients
        ]
    }


@app.post("/api/v1/management/patients/{patient_reference}/observations", status_code=201)
def create_management_patient_observation(
    patient_reference: str,
    payload: PatientObservationPayload,
    principal: Annotated[DemoPrincipal, Depends(require_demo_role("management", "admin"))],
    db: Annotated[Session, Depends(get_nursing_db)],
) -> dict[str, object]:
    patient = db.get(Patient, patient_reference)
    if patient is None or patient.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Paciente não encontrado")
    row = PatientObservation(
        patient_reference=patient_reference,
        attention_level=payload.attention_level,
        observation=payload.observation.strip(),
        treatment_status=payload.treatment_status,
        actor_id=principal.user_id,
        actor_name=principal.actor_name,
        created_at=datetime.now(UTC),
    )
    db.add(row)
    emit_audit_event(principal, "management", "patient_status_updated", patient_reference, db=db)
    db.commit()
    db.refresh(row)
    return {
        "patient_reference": patient_reference,
        "attention_level": row.attention_level,
        "treatment_status": row.treatment_status,
        "observation": row.observation,
        "actor_name": row.actor_name,
        "updated_at": row.created_at.isoformat(),
    }


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
    emit_audit_event(
        principal, "nursing", "vital_record_voided", str(record.id), db=db
    )
    db.commit()
    return {"status": "voided", "id": str(record.id)}


def can_view_full_patient_profile(principal: DemoPrincipal) -> bool:
    return any(module in principal.modules and "consultar" in principal.permissions.get(module, []) for module in ("patients", "reception", "management"))


def can_view_patient_allergies(principal: DemoPrincipal) -> bool:
    return any(
        module in principal.modules and "consultar" in principal.permissions.get(module, [])
        for module in ("nursing", "nutrition", "pharmacy", "therapy", "xray", "physician", "psychology", "management")
    )


def can_view_patient_treatment_track(principal: DemoPrincipal) -> bool:
    return any(
        module in principal.modules and "consultar" in principal.permissions.get(module, [])
        for module in ("nursing", "psychology", "physician", "management")
    )


def serialize_patient(patient: Patient, *, principal: DemoPrincipal, full_profile: bool = False) -> dict[str, object]:
    result: dict[str, object] = {
        "reference": patient.reference,
        "name": patient.name,
        "room": patient.room,
        "bed": patient.bed,
        "birth_date": patient.birth_date,
        "active": patient.active,
    }
    if full_profile:
        for key in PatientPayload.model_fields:
            if key == "bed_id" or key == "elopement_risk":
                continue
            if key in {"allergies", "allergies_status"} and not can_view_patient_allergies(principal):
                continue
            if key == "treatment_track" and not can_view_patient_treatment_track(principal):
                continue
            if not hasattr(patient, key):
                continue
            result[key] = getattr(patient, key)
        result.update({"created_at": patient.created_at.isoformat() if patient.created_at else None, "updated_at": patient.updated_at.isoformat() if patient.updated_at else None, "updated_by": patient.updated_by})
    if "nursing" in principal.modules and "consultar" in principal.permissions.get("nursing", []):
        result["elopement_risk"] = patient.elopement_risk
    if can_view_patient_allergies(principal):
        result["allergies"] = patient.allergies
        result["allergies_status"] = patient.allergies_status
    if can_view_patient_treatment_track(principal):
        result["treatment_track"] = patient.treatment_track
    return result


@app.get("/api/v1/nursing/vitals")
def list_vital_records(
    principal: Annotated[DemoPrincipal, Depends(NURSING_VITALS_READ)],
    db: Annotated[Session, Depends(get_nursing_db)],
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
    offset: Annotated[int, Query(ge=0)] = 0,
    patient_reference: str | None = None,
    room: str | None = None,
    bed: str | None = None,
    from_date: date | None = None,
    to_date: date | None = None,
    from_at: datetime | None = None,
    to_at: datetime | None = None,
) -> dict[str, object]:
    if (from_at or to_at) and (from_date or to_date):
        raise HTTPException(status_code=422, detail="Use datas ou data e hora, não ambos os formatos")
    if any(value and (value.tzinfo is None or value.utcoffset() is None) for value in (from_at, to_at)):
        raise HTTPException(status_code=422, detail="Informe data e hora com fuso horário")
    if from_at and to_at and to_at < from_at:
        raise HTTPException(status_code=422, detail="A data e hora inicial deve ser anterior ou igual à final")
    if from_date and to_date and from_date > to_date:
        raise HTTPException(status_code=422, detail="A data inicial deve ser anterior ou igual à data final")

    filters = []
    if patient_reference:
        filters.append(VitalRecord.patient_reference == patient_reference)
    if room:
        filters.append(Patient.room == room)
    if bed:
        filters.append(Patient.bed == bed)
    if from_at:
        filters.append(VitalRecord.recorded_at >= from_at.astimezone(UTC))
    elif from_date:
        filters.append(VitalRecord.recorded_at >= datetime.combine(from_date, time.min, UTC))
    if to_at:
        filters.append(VitalRecord.recorded_at <= to_at.astimezone(UTC))
    elif to_date:
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
    measured_at = record.measured_at or record.recorded_at
    recorded_at = record.recorded_at
    if measured_at.tzinfo is None:
        measured_at = measured_at.replace(tzinfo=UTC)
    if recorded_at.tzinfo is None:
        recorded_at = recorded_at.replace(tzinfo=UTC)
    return {
        "id": record.id,
        "patient_reference": record.patient_reference,
        "actor_id": record.actor_id,
        "actor_name": record.actor_name,
        "values": record.values,
        "glucose_unit": record.glucose_unit,
        "not_applicable": record.not_applicable,
        "measured_at": measured_at.isoformat(),
        "recorded_at": recorded_at.isoformat(),
    }


@app.get("/api/v1/nursing/nutrition")
def list_nutrition_records(
    principal: Annotated[DemoPrincipal, Depends(NUTRITION_REPORT_ACCESS)],
    db: Annotated[Session, Depends(get_nursing_db)],
    q: Annotated[str, Query(max_length=120)] = "",
    patient_reference: str | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> dict[str, object]:
    filters = [NutritionRecord.voided_at.is_(None)]
    if patient_reference:
        filters.append(NutritionRecord.patient_reference == patient_reference)
    if q.strip():
        search_pattern = f"%{q.strip()}%"
        filters.append(
            (Patient.name.ilike(search_pattern))
            | (Patient.room.ilike(search_pattern))
            | (Patient.bed.ilike(search_pattern))
            | (NutritionRecord.diet_type.ilike(search_pattern))
            | (NutritionRecord.allergies.ilike(search_pattern))
            | (NutritionRecord.restrictions.ilike(search_pattern))
            | (NutritionRecord.notes.ilike(search_pattern))
        )
    query = (
        select(NutritionRecord)
        .join(Patient, Patient.reference == NutritionRecord.patient_reference)
        .where(*filters)
        .order_by(NutritionRecord.assessment_date.desc(), NutritionRecord.id.desc())
    )
    count_query = (
        select(func.count(NutritionRecord.id))
        .join(Patient, Patient.reference == NutritionRecord.patient_reference)
        .where(*filters)
    )
    records = db.scalars(query.offset(offset).limit(limit)).all()
    total = db.scalar(count_query) or 0
    emit_audit_event(principal, "nutrition", "nutrition_records_read", patient_reference or "nutrition_query")
    return {
        "records": [serialize_nutrition_record(record) for record in records],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


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
    if payload.allergies_status is not None and (
        payload.allergies_status != patient.allergies_status
        or payload.allergies != patient.allergies
    ):
        record_patient_allergy_change(
            db,
            principal,
            patient,
            payload.allergies_status,
            payload.allergies,
            "Confirmação durante avaliação nutricional",
        )
        patient.allergies = payload.allergies
        patient.allergies_status = payload.allergies_status
        patient.updated_at = datetime.now(UTC)
        patient.updated_by = principal.actor_name
        emit_audit_event(
            principal, "patients", "patient_allergies_updated", patient.reference, db=db
        )
    elif payload.allergies.strip() and payload.allergies.strip() != patient.allergies:
        record_patient_allergy_change(
            db,
            principal,
            patient,
            "known",
            payload.allergies,
            "Atualização durante avaliação nutricional",
        )
        patient.allergies = payload.allergies
        patient.allergies_status = "known"
        patient.updated_at = datetime.now(UTC)
        patient.updated_by = principal.actor_name
        emit_audit_event(
            principal, "patients", "patient_allergies_updated", patient.reference, db=db
        )
    record = NutritionRecord(
        **payload.model_dump(exclude={"allergies_status"}), actor_id=principal.user_id, actor_name=principal.actor_name,
        created_at=datetime.now(UTC),
    )
    db.add(record)
    emit_audit_event(
        principal, "nutrition", "nutrition_record_created",
        payload.patient_reference, db=db,
    )
    db.commit()
    db.refresh(record)
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
    emit_audit_event(
        principal, "nutrition", "nutrition_record_voided", str(record.id), db=db
    )
    db.commit()
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
