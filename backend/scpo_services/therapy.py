import uuid
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import (
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    select,
)
from sqlalchemy.orm import Mapped, Session, mapped_column

from .common import (
    Base,
    DemoPrincipal,
    audit_outbox_lifespan,
    database_session,
    emit_audit_event,
    require_demo_role,
    verify_database_migrated,
)
from .nursing import Patient


class TherapyActivity(Base):
    __tablename__ = "therapy_activities"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    activity_type: Mapped[str] = mapped_column(String(40), nullable=False)
    description: Mapped[str] = mapped_column(String(1000), nullable=False, default="")
    location: Mapped[str] = mapped_column(String(120), nullable=False)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    patient_reference: Mapped[str | None] = mapped_column(String(36), ForeignKey("patients.reference", ondelete="RESTRICT"), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="scheduled")
    activity_report: Mapped[str] = mapped_column(Text, nullable=False, default="")
    report_updated_by: Mapped[str | None] = mapped_column(String(120), nullable=True)
    report_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class TherapyActivityAttendance(Base):
    __tablename__ = "therapy_activity_attendance"
    __table_args__ = (
        UniqueConstraint("activity_id", "patient_reference", name="uq_therapy_attendance_activity_patient"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    activity_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("therapy_activities.id", ondelete="CASCADE"), nullable=False
    )
    patient_reference: Mapped[str] = mapped_column(
        String(36), ForeignKey("patients.reference", ondelete="RESTRICT"), nullable=False
    )
    attendance: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")


def get_therapy_db():
    yield from database_session("nursing")


@asynccontextmanager
async def lifespan(_: FastAPI):
    verify_database_migrated("nursing")
    async with audit_outbox_lifespan("nursing"):
        yield


app = FastAPI(title="SCPO Connect · Oficina Terapêutica", version="1.0.0", lifespan=lifespan)
THERAPY_ROLE = require_demo_role("therapy")
THERAPY_REPORT_ACCESS = require_demo_role("therapy", "management", "admin", "oversight")


class ActivityPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=3, max_length=120)
    activity_type: Literal["grupo", "arte", "música", "movimento", "ocupacional", "recreação", "outro"]
    description: str = Field(default="", max_length=1000)
    location: str = Field(min_length=2, max_length=120)
    starts_at: datetime
    ends_at: datetime | None = None
    patient_reference: str | None = Field(default=None, max_length=36)
    participant_references: list[str] = Field(default_factory=list, max_length=100)

    @field_validator("title", "location", "activity_type", mode="before")
    @classmethod
    def trim_required_text(cls, value: object) -> object:
        if isinstance(value, str):
            trimmed = value.strip()
            return trimmed if trimmed else None
        return value

    @field_validator("patient_reference", mode="before")
    @classmethod
    def normalize_optional_reference(cls, value: object) -> object:
        if value is None:
            return None
        if isinstance(value, str):
            trimmed = value.strip()
            return trimmed or None
        return value

    @field_validator("participant_references", mode="before")
    @classmethod
    def normalize_participants(cls, value: object) -> list[str]:
        if value is None:
            return []
        if isinstance(value, str):
            return [item.strip() for item in value.split(',') if item.strip()]
        if isinstance(value, list):
            return [str(item).strip() for item in value if str(item).strip()]
        return []

    @field_validator("participant_references")
    @classmethod
    def require_unique_participants(cls, value: list[str]) -> list[str]:
        if len(set(value)) != len(value):
            raise ValueError("Não repita participantes na mesma atividade")
        return value


class ActivityParticipantPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    patient_reference: str = Field(min_length=1, max_length=36)
    attendance: Literal["pending", "attended", "absent"] = "pending"


class ActivityParticipantsPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    participants: list[ActivityParticipantPayload] = Field(max_length=100)

    @field_validator("participants")
    @classmethod
    def require_unique_participants(cls, value: list[ActivityParticipantPayload]) -> list[ActivityParticipantPayload]:
        references = [participant.patient_reference for participant in value]
        if len(set(references)) != len(references):
            raise ValueError("Não repita participantes na mesma atividade")
        return value


class ActivityReportPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    activity_report: str = Field(default="", max_length=4000)
    status: Literal["scheduled", "in_progress", "completed", "cancelled"]


@app.get("/health")
def health() -> dict[str, str]:
    return {"service": "therapy", "status": "ok"}


@app.get("/api/v1/therapy/activities")
def list_activities(
    principal: Annotated[DemoPrincipal, Depends(THERAPY_REPORT_ACCESS)],
    db: Annotated[Session, Depends(get_therapy_db)],
    from_date: datetime | None = None,
    to_date: datetime | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> dict[str, object]:
    query = select(TherapyActivity)
    if from_date:
        query = query.where(TherapyActivity.starts_at >= from_date)
    if to_date:
        query = query.where(TherapyActivity.starts_at < to_date)
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    activities = db.scalars(query.order_by(TherapyActivity.starts_at).offset(offset).limit(limit)).all()
    emit_audit_event(principal, "therapy", "therapy_activities_read", "therapy_calendar")
    attendance = activity_attendance(db, [activity.id for activity in activities])
    return {"activities": [serialize_activity(activity, attendance.get(activity.id, [])) for activity in activities], "total": total, "limit": limit, "offset": offset}


@app.get("/api/v1/therapy/participants")
def list_therapy_participants(
    principal: Annotated[DemoPrincipal, THERAPY_REPORT_ACCESS],
    db: Annotated[Session, Depends(get_therapy_db)],
) -> dict[str, list[dict[str, object]]]:
    patients = db.scalars(
        select(Patient)
        .where(Patient.active.is_(True), Patient.deleted_at.is_(None))
        .order_by(Patient.name)
    ).all()
    emit_audit_event(principal, "therapy", "therapy_participant_roster_read", "active_patients")
    return {
        "participants": [
            {
                "reference": patient.reference,
                "name": patient.name,
                "birth_date": patient.birth_date.isoformat() if patient.birth_date else None,
            }
            for patient in patients
        ]
    }


@app.patch("/api/v1/therapy/activities/{activity_id}/report")
def update_activity_report(
    activity_id: str,
    payload: ActivityReportPayload,
    principal: Annotated[DemoPrincipal, Depends(THERAPY_ROLE)],
    db: Annotated[Session, Depends(get_therapy_db)],
) -> dict[str, object]:
    activity = db.get(TherapyActivity, activity_id)
    if activity is None:
        raise HTTPException(status_code=404, detail="Atividade não encontrada")
    activity.activity_report = payload.activity_report.strip()
    activity.status = payload.status
    activity.report_updated_by = principal.actor_name
    activity.report_updated_at = datetime.now(UTC)
    emit_audit_event(
        principal, "therapy", "therapy_report_updated",
        activity.patient_reference or activity.id, db=db,
    )
    db.commit()
    db.refresh(activity)
    return serialize_activity(activity, activity_attendance(db, [activity.id]).get(activity.id, []))


@app.put("/api/v1/therapy/activities/{activity_id}/participants")
def update_activity_participants(
    activity_id: str,
    payload: ActivityParticipantsPayload,
    principal: Annotated[DemoPrincipal, Depends(THERAPY_ROLE)],
    db: Annotated[Session, Depends(get_therapy_db)],
) -> dict[str, object]:
    activity = db.get(TherapyActivity, activity_id)
    if activity is None:
        raise HTTPException(status_code=404, detail="Atividade não encontrada")
    references = [item.patient_reference for item in payload.participants]
    valid_references = set(db.scalars(select(Patient.reference).where(Patient.reference.in_(references))).all()) if references else set()
    if valid_references != set(references):
        raise HTTPException(status_code=404, detail="Um ou mais pacientes não foram encontrados")
    existing = {
        participant.patient_reference: participant
        for participant in db.scalars(
            select(TherapyActivityAttendance).where(TherapyActivityAttendance.activity_id == activity_id)
        ).all()
    }
    submitted_references = set(references)
    for reference, participant in existing.items():
        if reference not in submitted_references:
            db.delete(participant)
    for item in payload.participants:
        participant = existing.get(item.patient_reference)
        if participant is None:
            participant = TherapyActivityAttendance(
                activity_id=activity_id,
                patient_reference=item.patient_reference,
                attendance=item.attendance,
            )
            db.add(participant)
        else:
            participant.attendance = item.attendance
    emit_audit_event(principal, "therapy", "therapy_attendance_updated", activity_id, db=db)
    db.commit()
    db.refresh(activity)
    attendance = activity_attendance(db, [activity.id]).get(activity.id, [])
    return serialize_activity(activity, attendance)


@app.post("/api/v1/therapy/activities", status_code=201)
def create_activity(
    payload: ActivityPayload,
    principal: Annotated[DemoPrincipal, Depends(THERAPY_ROLE)],
    db: Annotated[Session, Depends(get_therapy_db)],
) -> dict[str, object]:
    starts_at = payload.starts_at
    if starts_at.tzinfo is None:
        raise HTTPException(status_code=422, detail="Informe o fuso horário da atividade")
    if payload.ends_at and (payload.ends_at.tzinfo is None or payload.ends_at <= starts_at):
        raise HTTPException(status_code=422, detail="O término deve ocorrer após o início")
    participant_references = list(payload.participant_references)
    if payload.patient_reference and payload.patient_reference not in participant_references:
        participant_references.insert(0, payload.patient_reference)
    valid_references = set(db.scalars(select(Patient.reference).where(Patient.reference.in_(participant_references))).all()) if participant_references else set()
    if valid_references != set(participant_references):
        raise HTTPException(status_code=404, detail="Um ou mais pacientes não foram encontrados")
    activity_fields = payload.model_dump(exclude={"participant_references"})
    activity = TherapyActivity(
        id=str(uuid.uuid4()),
        **{**activity_fields, "starts_at": starts_at.astimezone(UTC), "ends_at": payload.ends_at.astimezone(UTC) if payload.ends_at else None},
        status="scheduled",
        created_by=principal.actor_name,
        created_at=datetime.now(UTC),
    )
    db.add(activity)
    db.flush()
    for reference in participant_references:
        db.add(TherapyActivityAttendance(activity_id=activity.id, patient_reference=reference))
    emit_audit_event(
        principal, "therapy", "therapy_activity_created",
        activity.patient_reference or activity.id, db=db,
    )
    db.commit()
    db.refresh(activity)
    attendance = activity_attendance(db, [activity.id]).get(activity.id, [])
    return serialize_activity(activity, attendance)


def activity_attendance(db: Session, activity_ids: list[str]) -> dict[str, list[dict[str, str]]]:
    if not activity_ids:
        return {}
    participants = db.scalars(
        select(TherapyActivityAttendance)
        .where(TherapyActivityAttendance.activity_id.in_(activity_ids))
        .order_by(TherapyActivityAttendance.id)
    ).all()
    return {
        activity_id: [
            {"patient_reference": participant.patient_reference, "attendance": participant.attendance}
            for participant in participants
            if participant.activity_id == activity_id
        ]
        for activity_id in activity_ids
    }


def serialize_activity(
    activity: TherapyActivity,
    participants: list[dict[str, str]] | None = None,
) -> dict[str, object]:
    starts_at = activity.starts_at if activity.starts_at.tzinfo else activity.starts_at.replace(tzinfo=UTC)
    ends_at = activity.ends_at if activity.ends_at and activity.ends_at.tzinfo else activity.ends_at.replace(tzinfo=UTC) if activity.ends_at else None
    return {
        "id": activity.id,
        "title": activity.title,
        "activity_type": activity.activity_type,
        "description": activity.description,
        "location": activity.location,
        "starts_at": starts_at.astimezone(UTC).isoformat(),
        "ends_at": ends_at.astimezone(UTC).isoformat() if ends_at else None,
        "patient_reference": activity.patient_reference,
        "participants": participants or [],
        "status": activity.status,
        "activity_report": activity.activity_report,
        "report_updated_by": activity.report_updated_by,
        "report_updated_at": activity.report_updated_at.isoformat() if activity.report_updated_at else None,
        "created_by": activity.created_by,
        "created_at": activity.created_at.isoformat(),
    }
