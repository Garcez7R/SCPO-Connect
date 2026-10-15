from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Annotated, Literal

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
)


class ExamRequest(Base):
    __tablename__ = "exam_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    patient_reference: Mapped[str] = mapped_column(String(32), nullable=False)
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
    patient_reference: Literal["DEMO-001"]
    exam_label: str = Field(min_length=1, max_length=80)


@app.get("/health")
def health() -> dict[str, str]:
    return {"service": "xray", "status": "ok"}


@app.get("/api/v1/xray/requests")
def list_requests(
    _: Annotated[DemoPrincipal, Depends(XRAY_ROLE)],
    db: Annotated[Session, Depends(get_xray_db)],
) -> dict[str, list[dict[str, object]]]:
    return {
        "requests": [
            serialize_request(item)
            for item in db.scalars(
                select(ExamRequest).order_by(ExamRequest.created_at.desc())
            ).all()
        ]
    }


@app.post("/api/v1/xray/requests", status_code=201)
def create_request(
    payload: ExamRequestPayload,
    _: Annotated[DemoPrincipal, Depends(XRAY_ROLE)],
    db: Annotated[Session, Depends(get_xray_db)],
) -> dict[str, object]:
    request = ExamRequest(
        **payload.model_dump(), status="requested", created_at=datetime.now(UTC)
    )
    db.add(request)
    db.commit()
    db.refresh(request)
    return serialize_request(request)


def serialize_request(request: ExamRequest) -> dict[str, object]:
    return {
        "id": request.id,
        "patient_reference": request.patient_reference,
        "exam_label": request.exam_label,
        "status": request.status,
        "created_at": request.created_at.isoformat(),
    }
