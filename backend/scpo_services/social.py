from contextlib import asynccontextmanager
from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import (
    JSON,
    Date,
    DateTime,
    Integer,
    String,
    Text,
    and_,
    func,
    or_,
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
    verify_patient_reference,
)


class Referral(Base):
    __tablename__ = "social_referrals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    patient_reference: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    referral_type: Mapped[str] = mapped_column(String(80), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="open")
    priority: Mapped[str] = mapped_column(String(16), nullable=False, default="routine")
    assignee: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    follow_up_due: Mapped[date | None] = mapped_column(Date, nullable=True)
    next_step: Mapped[str] = mapped_column(String(300), nullable=False, default="")
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


class InterprofessionalShare(Base):
    __tablename__ = "interprofessional_shares"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    patient_reference: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    sender_module: Mapped[str] = mapped_column(String(16), nullable=False)
    recipient_module: Mapped[str] = mapped_column(String(16), nullable=False)
    categories: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    purpose: Mapped[str] = mapped_column(String(300), nullable=False)
    created_by: Mapped[str] = mapped_column(String(36), nullable=False)
    created_by_name: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_by: Mapped[str | None] = mapped_column(String(36), nullable=True)


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
SOCIAL_REPORT_ACCESS = require_demo_role("social", "management", "admin", "oversight")
PSYCHOLOGY_REPORT_ACCESS = require_demo_role("psychology", "management", "admin", "oversight")


class ReferralPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    patient_reference: str = Field(min_length=1, max_length=36)
    referral_type: str = Field(min_length=1, max_length=80)
    priority: Literal["routine", "priority"] = "routine"
    assignee: str = Field(default="", max_length=120)
    follow_up_due: date | None = None
    next_step: str = Field(default="", max_length=300)

    @field_validator("referral_type", "assignee", "next_step", mode="before")
    @classmethod
    def trim_referral_text(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        value = value.strip()
        return value

    @field_validator("referral_type")
    @classmethod
    def require_referral_type(cls, value: str) -> str:
        if len(value.strip()) < 2:
            raise ValueError("Informe o tipo de encaminhamento")
        return value.strip()


class ReferralUpdatePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["open", "scheduled", "in_progress", "completed", "cancelled"] | None = None
    priority: Literal["routine", "priority"] | None = None
    assignee: str | None = Field(default=None, max_length=120)
    follow_up_due: date | None = None
    next_step: str | None = Field(default=None, max_length=300)

    @field_validator("assignee", "next_step", mode="before")
    @classmethod
    def trim_update_text(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


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


class InterprofessionalSharePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    patient_reference: str = Field(min_length=1, max_length=36)
    sender_module: Literal["social", "psychology"]
    recipient_module: Literal["social", "psychology"]
    categories: list[Literal[
        "care_needs", "family_support", "social_context", "safety_followup", "contact_plan", "other"
    ]] = Field(min_length=1, max_length=6)
    summary: str = Field(min_length=3, max_length=2000)
    purpose: str = Field(min_length=10, max_length=300)
    expires_in_days: Literal[7, 14, 30] | None = 7

    @field_validator("categories")
    @classmethod
    def require_unique_categories(cls, value: list[str]) -> list[str]:
        if len(set(value)) != len(value):
            raise ValueError("Não repita categorias de informação")
        return value

    @field_validator("summary", "purpose", mode="before")
    @classmethod
    def trim_shared_text(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @model_validator(mode="after")
    def require_distinct_modules(self) -> "InterprofessionalSharePayload":
        if self.sender_module == self.recipient_module:
            raise ValueError("Escolha o outro módulo como destinatário")
        return self


class InterprofessionalShareRevocation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revoked: Literal[True]


@app.get("/health")
def health() -> dict[str, str]:
    return {"service": "social", "status": "ok"}


@app.get("/api/v1/social/referrals")
def list_referrals(
    principal: Annotated[DemoPrincipal, Depends(SOCIAL_REPORT_ACCESS)],
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
    changes = {
        field: value
        for field, value in payload.model_dump(exclude_unset=True).items()
        if value is not None or field == "follow_up_due"
    }
    if not changes:
        raise HTTPException(status_code=422, detail="Informe uma alteração para o encaminhamento")
    referral = db.get(Referral, referral_id)
    if referral is None:
        raise HTTPException(status_code=404, detail="Encaminhamento não encontrado")
    if referral.status in {"completed", "cancelled"} and changes.get("status", referral.status) != referral.status:
        raise HTTPException(status_code=409, detail="O encaminhamento já foi encerrado")
    for field, value in changes.items():
        setattr(referral, field, value)
    emit_audit_event(
        principal, "social", "social_referral_updated", str(referral.id), db=db
    )
    db.commit()
    db.refresh(referral)
    return serialize_referral(referral)


@app.get("/api/v1/psychology/referrals")
def list_psychology_referrals(
    principal: Annotated[DemoPrincipal, Depends(PSYCHOLOGY_REPORT_ACCESS)],
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
    principal: Annotated[
        DemoPrincipal,
        Depends(require_demo_role("nursing", "physician", "psychology", "admin")),
    ],
    db: Annotated[Session, Depends(get_social_db)],
    limit: Annotated[int, Query(ge=1, le=200)] = 200,
    offset: Annotated[int, Query(ge=0)] = 0,
    patient_reference: str | None = None,
) -> dict[str, object]:
    query = select(PsychologyEncounter)
    if patient_reference:
        query = query.where(PsychologyEncounter.patient_reference == patient_reference)
    rows = db.scalars(
        query.order_by(
            PsychologyEncounter.created_at.desc(), PsychologyEncounter.id.desc()
        )
        .limit(limit)
        .offset(offset)
    ).all()
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    emit_audit_event(principal, "psychology", "psychology_encounters_read", "psychology_encounters")
    return {
        "encounters": [serialize_psychology_encounter(item) for item in rows],
        "total": total,
    }


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


@app.get("/api/v1/interprofessional/shares")
def list_interprofessional_shares(
    principal: Annotated[DemoPrincipal, Depends(require_demo_role("social", "psychology"))],
    db: Annotated[Session, Depends(get_social_db)],
    module: Literal["social", "psychology"] | None = None,
) -> dict[str, list[dict[str, object]]]:
    modules = [module] if module else ["social", "psychology"]
    authorized_modules = [
        selected
        for selected in modules
        if selected in principal.modules and "consultar" in principal.permissions.get(selected, [])
    ]
    if not authorized_modules:
        raise HTTPException(status_code=403, detail="Acesso não autorizado ao compartilhamento")

    now = datetime.now(UTC)
    access_conditions = []
    for selected in authorized_modules:
        access_conditions.extend([
            and_(
                InterprofessionalShare.recipient_module == selected,
                InterprofessionalShare.revoked_at.is_(None),
                or_(
                    InterprofessionalShare.expires_at.is_(None),
                    InterprofessionalShare.expires_at > now,
                ),
            ),
            and_(
                InterprofessionalShare.sender_module == selected,
                InterprofessionalShare.created_by == principal.user_id,
            ),
        ])
    shares = db.scalars(
        select(InterprofessionalShare)
        .where(or_(*access_conditions))
        .order_by(InterprofessionalShare.created_at.desc())
        .limit(500)
    ).all()
    result = []
    for share in shares:
        direction = "received"
        if module is not None:
            if share.sender_module == module:
                direction = "sent"
            elif share.recipient_module == module:
                direction = "received"
        elif share.created_by == principal.user_id:
            direction = "sent"
        emit_audit_event(
            principal, "interprofessional", "interprofessional_share_read", str(share.id)
        )
        result.append(serialize_interprofessional_share(share, direction, now))
    return {"shares": result}


@app.post("/api/v1/interprofessional/shares", status_code=201)
def create_interprofessional_share(
    payload: InterprofessionalSharePayload,
    principal: Annotated[DemoPrincipal, Depends(require_demo_role("social", "psychology"))],
    db: Annotated[Session, Depends(get_social_db)],
) -> dict[str, object]:
    if payload.sender_module == payload.recipient_module:
        raise HTTPException(status_code=422, detail="Escolha o outro módulo como destinatário")
    if (
        payload.sender_module not in principal.modules
        or "criar" not in principal.permissions.get(payload.sender_module, [])
    ):
        raise HTTPException(status_code=403, detail="Sem permissão para compartilhar por este módulo")

    verify_patient_reference(payload.patient_reference)
    now = datetime.now(UTC)
    share = InterprofessionalShare(
        patient_reference=payload.patient_reference,
        sender_module=payload.sender_module,
        recipient_module=payload.recipient_module,
        categories=payload.categories,
        summary=payload.summary,
        purpose=payload.purpose,
        created_by=principal.user_id,
        created_by_name=principal.actor_name,
        created_at=now,
        expires_at=now + timedelta(days=payload.expires_in_days)
        if payload.expires_in_days is not None
        else None,
    )
    db.add(share)
    db.flush()
    emit_audit_event(
        principal, "interprofessional", "interprofessional_share_created", str(share.id), db=db
    )
    db.commit()
    db.refresh(share)
    return serialize_interprofessional_share(share, "sent", now)


@app.patch("/api/v1/interprofessional/shares/{share_id}")
def revoke_interprofessional_share(
    share_id: int,
    payload: InterprofessionalShareRevocation,
    principal: Annotated[DemoPrincipal, Depends(require_demo_role("social", "psychology"))],
    db: Annotated[Session, Depends(get_social_db)],
) -> dict[str, object]:
    share = db.get(InterprofessionalShare, share_id)
    if share is None:
        raise HTTPException(status_code=404, detail="Compartilhamento não encontrado")
    if (
        share.created_by != principal.user_id
        or share.sender_module not in principal.modules
        or "alterar" not in principal.permissions.get(share.sender_module, [])
    ):
        raise HTTPException(status_code=403, detail="Somente o autor pode revogar este compartilhamento")
    if share.revoked_at is not None:
        raise HTTPException(status_code=409, detail="O compartilhamento já foi revogado")

    share.revoked_at = datetime.now(UTC)
    share.revoked_by = principal.user_id
    emit_audit_event(
        principal, "interprofessional", "interprofessional_share_revoked", str(share.id), db=db
    )
    db.commit()
    db.refresh(share)
    return serialize_interprofessional_share(share, "sent", datetime.now(UTC))


def serialize_interprofessional_share(
    share: InterprofessionalShare, direction: str, now: datetime
) -> dict[str, object]:
    expires_at = share.expires_at
    if expires_at is not None and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    return {
        "id": share.id,
        "patient_reference": share.patient_reference,
        "sender_module": share.sender_module,
        "recipient_module": share.recipient_module,
        "direction": direction,
        "categories": share.categories,
        "summary": share.summary,
        "purpose": share.purpose,
        "created_by_name": share.created_by_name,
        "created_at": share.created_at.isoformat(),
        "expires_at": expires_at.isoformat() if expires_at else None,
        "expired": expires_at is not None and expires_at <= now,
        "revoked_at": share.revoked_at.isoformat() if share.revoked_at else None,
    }


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
        "priority": referral.priority,
        "assignee": referral.assignee,
        "follow_up_due": referral.follow_up_due.isoformat() if referral.follow_up_due else None,
        "next_step": referral.next_step,
        "created_at": referral.created_at.isoformat(),
    }
