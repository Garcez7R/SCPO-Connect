from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import DateTime, Integer, String, select
from sqlalchemy.orm import Mapped, Session, mapped_column

from .common import (
    Base,
    DemoPrincipal,
    database_session,
    emit_audit_event,
    require_demo_role,
    verify_database_migrated,
    verify_patient_reference,
)


class ExamRequest(Base):
    __tablename__ = "exam_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    patient_reference: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    exam_label: Mapped[str] = mapped_column(String(80), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="requested")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )


def get_xray_db():
    yield from database_session("xray")


@asynccontextmanager
async def lifespan(_: FastAPI):
    verify_database_migrated("xray")
    yield


app = FastAPI(
    title="SCPO Connect · Serviço de Raio X", version="1.0.0", lifespan=lifespan
)
XRAY_ROLE = require_demo_role("xray")


class ExamRequestPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    patient_reference: str = Field(min_length=1, max_length=36)
    exam_label: str = Field(min_length=1, max_length=80)


class ExamRequestUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["requested", "scheduled", "in_progress", "completed", "cancelled"]


@app.get("/health")
def health() -> dict[str, str]:
    return {"service": "xray", "status": "ok"}


@app.get("/api/v1/xray/requests")
def list_requests(
    principal: Annotated[DemoPrincipal, Depends(XRAY_ROLE)],
    db: Annotated[Session, Depends(get_xray_db)],
) -> dict[str, list[dict[str, object]]]:
    requests = [serialize_request(item) for item in db.scalars(select(ExamRequest).order_by(ExamRequest.created_at.desc())).all()]
    emit_audit_event(principal, "xray", "xray_requests_read", "exam_requests")
    return {"requests": requests}


@app.post("/api/v1/xray/requests", status_code=201)
def create_request(
    payload: ExamRequestPayload,
    principal: Annotated[DemoPrincipal, Depends(XRAY_ROLE)],
    db: Annotated[Session, Depends(get_xray_db)],
) -> dict[str, object]:
    verify_patient_reference(payload.patient_reference)
    request = ExamRequest(
        **payload.model_dump(), status="requested", created_at=datetime.now(UTC)
    )
    db.add(request)
    db.commit()
    db.refresh(request)
    emit_audit_event(principal, "xray", "xray_request_created", request.patient_reference)
    return serialize_request(request)


@app.patch("/api/v1/xray/requests/{request_id}")
def update_request(
    request_id: int,
    payload: ExamRequestUpdate,
    principal: Annotated[DemoPrincipal, Depends(XRAY_ROLE)],
    db: Annotated[Session, Depends(get_xray_db)],
) -> dict[str, object]:
    request = db.get(ExamRequest, request_id)
    if request is None:
        raise HTTPException(status_code=404, detail="Solicitação de exame não encontrada")
    if request.status in {"completed", "cancelled"} and payload.status != request.status:
        raise HTTPException(
            status_code=409,
            detail="Solicitação encerrada; registre uma nova solicitação para novo atendimento",
        )
    request.status = payload.status
    db.commit()
    db.refresh(request)
    emit_audit_event(principal, "xray", "xray_request_status_changed", request.patient_reference)
    return serialize_request(request)


def serialize_request(request: ExamRequest) -> dict[str, object]:
    return {
        "id": request.id,
        "patient_reference": request.patient_reference,
        "exam_label": request.exam_label,
        "status": request.status,
        "created_at": request.created_at.isoformat(),
    }
