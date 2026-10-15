from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, FastAPI
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import DateTime, Integer, String, select
from sqlalchemy.orm import Mapped, Session, mapped_column

from .common import (
    Base,
    DemoPrincipal,
    database_session,
    require_demo_role,
    verify_database_migrated,
    verify_patient_reference,
    emit_audit_event,
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


def get_social_db():
    yield from database_session("social")


@asynccontextmanager
async def lifespan(_: FastAPI):
    verify_database_migrated("social")
    yield


app = FastAPI(title="SCPO Connect · Serviço Social", version="1.0.0", lifespan=lifespan)
SOCIAL_ROLE = require_demo_role("social")


class ReferralPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    patient_reference: str = Field(min_length=1, max_length=36)
    referral_type: str = Field(min_length=1, max_length=80)


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
    db.commit()
    db.refresh(referral)
    emit_audit_event(principal, "social", "social_referral_created", referral.patient_reference)
    return serialize_referral(referral)


def serialize_referral(referral: Referral) -> dict[str, object]:
    return {
        "id": referral.id,
        "patient_reference": referral.patient_reference,
        "referral_type": referral.referral_type,
        "status": referral.status,
        "created_at": referral.created_at.isoformat(),
    }
