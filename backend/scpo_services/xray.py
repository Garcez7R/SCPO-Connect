import uuid
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import DateTime, Integer, String, select
from sqlalchemy.orm import Mapped, Session, mapped_column

from .common import (
    Base,
    DemoPrincipal,
    audit_outbox_lifespan,
    database_session,
    emit_audit_event,
    register_audit_outbox_status_route,
    require_demo_role,
    verify_database_migrated,
    verify_patient_reference,
)


class ExamRequest(Base):
    __tablename__ = "exam_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    patient_reference: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    exam_label: Mapped[str] = mapped_column(String(80), nullable=False)
    exam_type: Mapped[str] = mapped_column(String(16), nullable=False, default="xray")
    group_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    observations: Mapped[str] = mapped_column(String(1000), nullable=False, default="")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="requested")
    result: Mapped[str] = mapped_column(String(4000), nullable=False, default="")
    result_recorded_by: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    result_recorded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )


def get_xray_db():
    yield from database_session("xray")


@asynccontextmanager
async def lifespan(_: FastAPI):
    verify_database_migrated("xray")
    async with audit_outbox_lifespan("xray"):
        yield


app = FastAPI(
    title="SCPO Connect · Central de Exames", version="1.0.0", lifespan=lifespan
)
register_audit_outbox_status_route(app, "xray")
XRAY_ROLE = require_demo_role("xray", "physician")
XRAY_REPORT_ACCESS = require_demo_role("xray", "physician", "management", "admin", "oversight")
LABORATORY_EXAMS = frozenset(
    {
        "TGO",
        "TGP",
        "Gama GT",
        "EQU (urina)",
        "HIV",
        "Sífilis",
        "TSH",
        "T3",
        "T4",
        "Vitamina B12",
        "Vitamina D",
        "HCV",
        "Anti-HBs",
        "Hemograma",
        "VHS",
        "PCR",
        "PSA",
        "Colesterol total",
        "Colesterol fracionado",
        "Triglicerídeos",
        "Ureia",
        "Creatinina",
        "Bilirrubina direta",
        "Bilirrubina indireta",
        "Bilirrubina total",
        "Amilase",
        "Lipase",
    }
)


class ExamRequestPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    patient_reference: str = Field(min_length=1, max_length=36)
    exam_label: str = Field(min_length=1, max_length=80)
    exam_type: Literal["xray", "ecg"] = "xray"
    observations: str = Field(default="", max_length=1000)


class ExamRequestUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["requested", "scheduled", "in_progress", "completed", "cancelled"] | None = None
    result: str | None = Field(default=None, max_length=4000)

    @field_validator("result")
    @classmethod
    def trim_result(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if len(value) < 3:
            raise ValueError("Informe um resultado objetivo com pelo menos três caracteres")
        return value

    @model_validator(mode="after")
    def require_change(self) -> "ExamRequestUpdate":
        if self.status is None and self.result is None:
            raise ValueError("Informe a situação ou o resultado")
        return self


class LaboratoryRequestPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    patient_reference: str = Field(min_length=1, max_length=36)
    exams: list[str] = Field(default_factory=list, max_length=40)
    other_exam: str = Field(default="", max_length=72)
    observations: str = Field(default="", max_length=1000)

    @field_validator("exams")
    @classmethod
    def validate_exams(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError("Selecione exames válidos sem duplicação")
        invalid = set(value) - LABORATORY_EXAMS
        if invalid:
            raise ValueError("A lista contém exames laboratoriais não reconhecidos")
        return value

    @field_validator("other_exam", "observations")
    @classmethod
    def trim_text(cls, value: str) -> str:
        return value.strip()

    @model_validator(mode="after")
    def require_exam(self) -> "LaboratoryRequestPayload":
        if not self.exams and not self.other_exam:
            raise ValueError("Selecione ao menos um exame ou informe outro exame")
        return self


@app.get("/health")
def health() -> dict[str, str]:
    return {"service": "xray", "status": "ok"}


@app.get("/api/v1/xray/requests")
def list_requests(
    principal: Annotated[DemoPrincipal, Depends(XRAY_REPORT_ACCESS)],
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
    emit_audit_event(
        principal, "xray", "xray_request_created", request.patient_reference, db=db
    )
    db.commit()
    db.refresh(request)
    return serialize_request(request)


@app.post("/api/v1/xray/laboratory-requests", status_code=201)
def create_laboratory_requests(
    payload: LaboratoryRequestPayload,
    principal: Annotated[DemoPrincipal, Depends(require_demo_role("physician", "xray"))],
    db: Annotated[Session, Depends(get_xray_db)],
) -> dict[str, list[dict[str, object]]]:
    verify_patient_reference(payload.patient_reference)
    labels = list(payload.exams)
    if payload.other_exam:
        labels.append(f"Outros: {payload.other_exam}")
    group_id = str(uuid.uuid4())
    requests = [
        ExamRequest(
            patient_reference=payload.patient_reference,
            exam_label=label,
            exam_type="laboratory",
            group_id=group_id,
            observations=payload.observations,
            status="requested",
            created_at=datetime.now(UTC),
        )
        for label in labels
    ]
    db.add_all(requests)
    emit_audit_event(
        principal,
        "xray",
        "laboratory_requests_created",
        payload.patient_reference,
        db=db,
    )
    db.commit()
    for request in requests:
        db.refresh(request)
    return {"requests": [serialize_request(request) for request in requests]}


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
    grouped_requests = (
        db.scalars(
            select(ExamRequest).where(ExamRequest.group_id == request.group_id)
        ).all()
        if request.group_id
        else [request]
    )
    if request.status in {"completed", "cancelled"} and payload.status not in {None, request.status}:
        raise HTTPException(
            status_code=409,
            detail="Solicitação encerrada; registre uma nova solicitação para novo atendimento",
        )
    if payload.status is not None:
        for grouped_request in grouped_requests:
            grouped_request.status = payload.status
    if payload.result is not None:
        recorded_at = datetime.now(UTC)
        for grouped_request in grouped_requests:
            grouped_request.result = payload.result
            grouped_request.result_recorded_by = principal.actor_name
            grouped_request.result_recorded_at = recorded_at
    emit_audit_event(
        principal,
        "xray",
        "xray_result_recorded" if payload.result is not None else "xray_request_status_changed",
        request.patient_reference,
        db=db,
    )
    db.commit()
    db.refresh(request)
    return serialize_request(request)


def serialize_request(request: ExamRequest) -> dict[str, object]:
    return {
        "id": request.id,
        "patient_reference": request.patient_reference,
        "exam_label": request.exam_label,
        "exam_type": request.exam_type,
        "group_id": request.group_id,
        "observations": request.observations,
        "status": request.status,
        "result": request.result,
        "result_recorded_by": request.result_recorded_by,
        "result_recorded_at": request.result_recorded_at.isoformat() if request.result_recorded_at else None,
        "created_at": request.created_at.isoformat(),
    }
