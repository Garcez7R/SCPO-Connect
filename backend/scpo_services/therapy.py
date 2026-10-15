import uuid
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import DateTime, Integer, String, Text, select
from sqlalchemy.orm import Mapped, Session, mapped_column

from .common import Base, DemoPrincipal, database_session, get_engine, require_demo_role, verify_database_migrated
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
    patient_reference: Mapped[str | None] = mapped_column(String(36), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="scheduled")
    activity_report: Mapped[str] = mapped_column(Text, nullable=False, default="")
    report_updated_by: Mapped[str | None] = mapped_column(String(120), nullable=True)
    report_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


def get_therapy_db():
    yield from database_session("nursing")


@asynccontextmanager
async def lifespan(_: FastAPI):
    verify_database_migrated("nursing")
    yield


app = FastAPI(title="SCPO Connect · Oficina Terapêutica", version="1.0.0", lifespan=lifespan)
THERAPY_ROLE = require_demo_role("therapy")
THERAPY_REPORT_ACCESS = require_demo_role("therapy", "management")


class ActivityPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=3, max_length=120)
    activity_type: Literal["grupo", "arte", "música", "movimento", "ocupacional", "recreação", "outro"]
    description: str = Field(default="", max_length=1000)
    location: str = Field(min_length=2, max_length=120)
    starts_at: datetime
    ends_at: datetime | None = None
    patient_reference: str | None = Field(default=None, max_length=36)


class ActivityReportPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    activity_report: str = Field(default="", max_length=4000)
    status: Literal["scheduled", "in_progress", "completed", "cancelled"]


@app.get("/health")
def health() -> dict[str, str]:
    return {"service": "therapy", "status": "ok"}


@app.get("/api/v1/therapy/activities")
def list_activities(
    _: Annotated[DemoPrincipal, Depends(THERAPY_REPORT_ACCESS)],
    db: Annotated[Session, Depends(get_therapy_db)],
    from_date: datetime | None = None,
    to_date: datetime | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
) -> dict[str, list[dict[str, object]]]:
    query = select(TherapyActivity)
    if from_date:
        query = query.where(TherapyActivity.starts_at >= from_date)
    if to_date:
        query = query.where(TherapyActivity.starts_at < to_date)
    activities = db.scalars(query.order_by(TherapyActivity.starts_at).limit(limit)).all()
    return {"activities": [serialize_activity(activity) for activity in activities]}


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
    db.commit()
    db.refresh(activity)
    return serialize_activity(activity)


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
    if payload.patient_reference:
        with Session(get_engine("nursing")) as patient_db:
            if patient_db.get(Patient, payload.patient_reference) is None:
                raise HTTPException(status_code=404, detail="Paciente não encontrado")
    activity = TherapyActivity(
        id=str(uuid.uuid4()),
        **{**payload.model_dump(), "starts_at": starts_at.astimezone(UTC), "ends_at": payload.ends_at.astimezone(UTC) if payload.ends_at else None},
        status="scheduled",
        created_by=principal.actor_name,
        created_at=datetime.now(UTC),
    )
    db.add(activity)
    db.commit()
    db.refresh(activity)
    return serialize_activity(activity)


def serialize_activity(activity: TherapyActivity) -> dict[str, object]:
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
        "status": activity.status,
        "activity_report": activity.activity_report,
        "report_updated_by": activity.report_updated_by,
        "report_updated_at": activity.report_updated_at.isoformat() if activity.report_updated_at else None,
        "created_by": activity.created_by,
        "created_at": activity.created_at.isoformat(),
    }
