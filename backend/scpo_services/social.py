from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import DateTime, Integer, String, Text, select
from sqlalchemy.orm import Mapped, Session, mapped_column

from .common import (
    Base,
    DemoPrincipal,
    audit_outbox_lifespan,
    database_session,
    emit_audit_event,
    require_demo_role,
    verify_database_migrated,
    verify_patient_reference,
)


class Referral(Base):
    __tablename__ = "social_referrals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    patient_reference: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    referral_type: Mapped[str] = mapped_column(String(80), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="open")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )


class PsychologyReferral(Base):
    __tablename__ = "psychology_referrals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    patient_reference: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    referral_type: Mapped[str] = mapped_column(String(80), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="open")
    priority: Mapped[str] = mapped_column(String(16), nullable=False, default="routine")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class PsychologyEncounter(Base):
    __tablename__ = "psychology_encounters"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    patient_reference: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    encounter_type: Mapped[str] = mapped_column(String(24), nullable=False)
    objective: Mapped[str] = mapped_column(String(500), nullable=False)
    evolution: Mapped[str] = mapped_column(Text, nullable=False)
    plan: Mapped[str] = mapped_column(Text, nullable=False)
    actor_id: Mapped[str] = mapped_column(String(36), nullable=False)
    actor_name: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


def get_social_db():
    yield from database_session("social")


@asynccontextmanager
async def lifespan(_: FastAPI):
    verify_database_migrated("social")
    async with audit_outbox_lifespan("social"):
        yield


app = FastAPI(title="SCPO Connect · Serviço Social", version="1.0.0", lifespan=lifespan)
SOCIAL_ROLE = require_demo_role("social")
PSYCHOLOGY_ROLE = require_demo_role("psychology")


class ReferralPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    patient_reference: str = Field(min_length=1, max_length=36)
    referral_type: str = Field(min_length=1, max_length=80)

    @field_validator("referral_type")
    @classmethod
    def trim_referral_type(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 2:
            raise ValueError("Informe o tipo de encaminhamento")
        return value


class ReferralUpdatePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["open", "scheduled", "in_progress", "completed", "cancelled"]


class PsychologyReferralPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    patient_reference: str = Field(min_length=1, max_length=36)
    referral_type: str = Field(min_length=2, max_length=80)
    priority: Literal["routine", "priority"] = "routine"


class PsychologyReferralUpdatePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["open", "scheduled", "in_progress", "completed", "cancelled"] | None = None
    priority: Literal["routine", "priority"] | None = None


class PsychologyEncounterPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    patient_reference: str = Field(min_length=1, max_length=36)
    encounter_type: Literal["intake", "follow_up", "psychiatry"]
    objective: str = Field(min_length=3, max_length=500)
    evolution: str = Field(min_length=3, max_length=4000)
    plan: str = Field(default="", max_length=4000)

    @field_validator("objective", "evolution", "plan", mode="before")
    @classmethod
    def trim_clinical_text(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


@app.get("/health")
def health() -> dict[str, str]:
    return {"service": "social", "status": "ok"}


@app.get("/api/v1/social/referrals")
def list_referrals(
    principal: Annotated[DemoPrincipal, Depends(SOCIAL_ROLE)],
    db: Annotated[Session, Depends(get_social_db)],
) -> dict[str, list[dict[str, object]]]:
    referrals = [
        serialize_referral(item)
        for item in db.scalars(
            select(Referral).order_by(Referral.created_at.desc())
        ).all()
    ]
    emit_audit_event(principal, "social", "social_referrals_read", "social_referrals")
    return {
        "referrals": referrals
    }


@app.post("/api/v1/social/referrals", status_code=201)
def create_referral(
    payload: ReferralPayload,
    principal: Annotated[DemoPrincipal, Depends(SOCIAL_ROLE)],
    db: Annotated[Session, Depends(get_social_db)],
) -> dict[str, object]:
    verify_patient_reference(payload.patient_reference)
    referral = Referral(
        **payload.model_dump(), status="open", created_at=datetime.now(UTC)
    )
    db.add(referral)
    emit_audit_event(
        principal, "social", "social_referral_created", referral.patient_reference, db=db
    )
    db.commit()
    db.refresh(referral)
    return serialize_referral(referral)


@app.patch("/api/v1/social/referrals/{referral_id}")
def update_referral(
    referral_id: int,
    payload: ReferralUpdatePayload,
    principal: Annotated[DemoPrincipal, Depends(SOCIAL_ROLE)],
    db: Annotated[Session, Depends(get_social_db)],
) -> dict[str, object]:
    referral = db.get(Referral, referral_id)
    if referral is None:
        raise HTTPException(status_code=404, detail="Encaminhamento não encontrado")
    if referral.status in {"completed", "cancelled"}:
        raise HTTPException(status_code=409, detail="O encaminhamento já foi encerrado")
    referral.status = payload.status
    emit_audit_event(
        principal, "social", "social_referral_status_updated", str(referral.id), db=db
    )
    db.commit()
    db.refresh(referral)
    return serialize_referral(referral)


@app.get("/api/v1/psychology/referrals")
def list_psychology_referrals(
    principal: Annotated[DemoPrincipal, Depends(PSYCHOLOGY_ROLE)],
    db: Annotated[Session, Depends(get_social_db)],
) -> dict[str, list[dict[str, object]]]:
    rows = db.scalars(
        select(PsychologyReferral).order_by(PsychologyReferral.created_at.desc())
    ).all()
    emit_audit_event(principal, "psychology", "psychology_referrals_read", "psychology_referrals")
    return {"referrals": [serialize_psychology_referral(item) for item in rows]}


@app.patch("/api/v1/psychology/referrals/{referral_id}")
def update_psychology_referral(
    referral_id: int,
    payload: PsychologyReferralUpdatePayload,
    principal: Annotated[DemoPrincipal, Depends(PSYCHOLOGY_ROLE)],
    db: Annotated[Session, Depends(get_social_db)],
) -> dict[str, object]:
    changes = payload.model_dump(exclude_unset=True, exclude_none=True)
    if not changes:
        raise HTTPException(status_code=422, detail="Informe uma alteração para o encaminhamento")
    referral = db.get(PsychologyReferral, referral_id)
    if referral is None:
        raise HTTPException(status_code=404, detail="Encaminhamento não encontrado")
    for field, value in changes.items():
        setattr(referral, field, value)
    emit_audit_event(
        principal, "psychology", "psychology_referral_updated", str(referral.id), db=db
    )
    db.commit()
    db.refresh(referral)
    return serialize_psychology_referral(referral)


@app.post("/api/v1/psychology/referrals", status_code=201)
def create_psychology_referral(
    payload: PsychologyReferralPayload,
    principal: Annotated[DemoPrincipal, Depends(PSYCHOLOGY_ROLE)],
    db: Annotated[Session, Depends(get_social_db)],
) -> dict[str, object]:
    verify_patient_reference(payload.patient_reference)
    referral = PsychologyReferral(
        **payload.model_dump(), status="open", created_at=datetime.now(UTC)
    )
    db.add(referral)
    emit_audit_event(
        principal, "psychology", "psychology_referral_created", str(referral.id), db=db
    )
    db.commit()
    db.refresh(referral)
    return serialize_psychology_referral(referral)


@app.get("/api/v1/psychology/encounters")
def list_psychology_encounters(
    principal: Annotated[DemoPrincipal, Depends(PSYCHOLOGY_ROLE)],
    db: Annotated[Session, Depends(get_social_db)],
    patient_reference: str | None = None,
) -> dict[str, list[dict[str, object]]]:
    query = select(PsychologyEncounter)
    if patient_reference:
        query = query.where(PsychologyEncounter.patient_reference == patient_reference)
    rows = db.scalars(
        query.order_by(PsychologyEncounter.created_at.desc()).limit(200)
    ).all()
    emit_audit_event(principal, "psychology", "psychology_encounters_read", "psychology_encounters")
    return {"encounters": [serialize_psychology_encounter(item) for item in rows]}


@app.post("/api/v1/psychology/encounters", status_code=201)
def create_psychology_encounter(
    payload: PsychologyEncounterPayload,
    principal: Annotated[DemoPrincipal, Depends(PSYCHOLOGY_ROLE)],
    db: Annotated[Session, Depends(get_social_db)],
) -> dict[str, object]:
    verify_patient_reference(payload.patient_reference)
    encounter = PsychologyEncounter(
        patient_reference=payload.patient_reference,
        encounter_type=payload.encounter_type,
        objective=payload.objective.strip(),
        evolution=payload.evolution.strip(),
        plan=payload.plan.strip(),
        actor_id=principal.user_id,
        actor_name=principal.actor_name,
        created_at=datetime.now(UTC),
    )
    db.add(encounter)
    emit_audit_event(
        principal, "psychology", "psychology_encounter_created", str(encounter.id), db=db
    )
    db.commit()
    db.refresh(encounter)
    return serialize_psychology_encounter(encounter)


def serialize_psychology_encounter(encounter: PsychologyEncounter) -> dict[str, object]:
    return {
        "id": encounter.id,
        "patient_reference": encounter.patient_reference,
        "encounter_type": encounter.encounter_type,
        "objective": encounter.objective,
        "evolution": encounter.evolution,
        "plan": encounter.plan,
        "actor_name": encounter.actor_name,
        "created_at": encounter.created_at.isoformat(),
    }


def serialize_psychology_referral(referral: PsychologyReferral) -> dict[str, object]:
    return {
        "id": referral.id,
        "patient_reference": referral.patient_reference,
        "referral_type": referral.referral_type,
        "status": referral.status,
        "priority": referral.priority,
        "created_at": referral.created_at.isoformat(),
    }


def serialize_referral(referral: Referral) -> dict[str, object]:
    return {
        "id": referral.id,
        "patient_reference": referral.patient_reference,
        "referral_type": referral.referral_type,
        "status": referral.status,
        "created_at": referral.created_at.isoformat(),
    }
