import os
import re
import uuid
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
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


class TherapyMaterial(Base):
    __tablename__ = "therapy_materials"
    __table_args__ = (CheckConstraint("quantity >= 0", name="ck_therapy_materials_quantity_nonnegative"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    category: Mapped[str] = mapped_column(String(40), nullable=False)
    unit: Mapped[str] = mapped_column(String(24), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    color_name: Mapped[str] = mapped_column(String(60), nullable=False, default="")
    color_code: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_by: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class TherapyMaterialMovement(Base):
    __tablename__ = "therapy_material_movements"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_therapy_material_movements_quantity_positive"),
        CheckConstraint("balance_after >= 0", name="ck_therapy_material_movements_balance_nonnegative"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    material_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("therapy_materials.id", ondelete="RESTRICT"), nullable=False
    )
    direction: Mapped[str] = mapped_column(String(12), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    balance_after: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    reason: Mapped[str] = mapped_column(String(300), nullable=False)
    actor_id: Mapped[str] = mapped_column(String(36), nullable=False)
    actor_name: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class TherapyMaterialImage(Base):
    __tablename__ = "therapy_material_images"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    filename: Mapped[str] = mapped_column(String(48), nullable=False, unique=True)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    content_type: Mapped[str] = mapped_column(String(24), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    uploaded_by: Mapped[str] = mapped_column(String(120), nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    folder_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey(
            "therapy_material_image_folders.id",
            name="fk_therapy_material_images_folder_id",
            ondelete="RESTRICT",
        ),
        nullable=True,
    )


class TherapyMaterialImageFolder(Base):
    __tablename__ = "therapy_material_image_folders"
    __table_args__ = (UniqueConstraint("name", name="uq_therapy_material_image_folders_name"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    created_by: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


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
MATERIAL_IMAGE_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}
MATERIAL_IMAGE_MAX_BYTES = 12 * 1024 * 1024


class TherapyMaterialImageFolderPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=80)

    @field_validator("name", mode="before")
    @classmethod
    def validate_folder_name(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        name = value.strip()
        if not name or name in {".", ".."} or any(
            character in name for character in ("/", "\\")
        ) or any(ord(character) < 32 for character in name):
            raise ValueError("Informe um nome de pasta válido, sem separadores de caminho")
        return name


class TherapyMaterialImageUpdatePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str | None = Field(default=None, min_length=2, max_length=120)
    folder_id: str | None = Field(default=None, max_length=36)

    @field_validator("title", mode="before")
    @classmethod
    def trim_title(cls, value: object) -> object:
        if isinstance(value, str):
            title = value.strip()
            if not title:
                raise ValueError("O título da imagem não pode ficar vazio")
            return title
        return value


def therapy_materials_directory() -> Path:
    configured_directory = os.getenv("SCPO_THERAPY_MATERIALS_DIR")
    if configured_directory:
        return Path(configured_directory).expanduser().resolve()
    local_data_directory = os.getenv("SCPO_LOCAL_DATA_DIR")
    if local_data_directory:
        return (Path(local_data_directory).expanduser() / "therapy-materials").resolve()
    return (Path(__file__).resolve().parents[2] / "data" / "therapy-materials").resolve()


def valid_material_image(content_type: str, content: bytes) -> bool:
    if content_type == "image/jpeg":
        return content.startswith(b"\xff\xd8\xff")
    if content_type == "image/png":
        return content.startswith(b"\x89PNG\r\n\x1a\n")
    return (
        content_type == "image/webp"
        and len(content) >= 12
        and content.startswith(b"RIFF")
        and content[8:12] == b"WEBP"
    )


def serialize_material(material: TherapyMaterial) -> dict[str, object]:
    return {
        "id": material.id,
        "name": material.name,
        "category": material.category,
        "unit": material.unit,
        "quantity": str(material.quantity),
        "color_name": material.color_name,
        "color_code": material.color_code,
        "active": material.active,
        "created_by": material.created_by,
        "created_at": material.created_at.isoformat(),
        "updated_at": material.updated_at.isoformat(),
    }


def serialize_material_image(
    image: TherapyMaterialImage,
    folder: TherapyMaterialImageFolder | None = None,
) -> dict[str, object]:
    return {
        "id": image.id,
        "filename": image.filename,
        "title": image.title,
        "content_type": image.content_type,
        "size_bytes": image.size_bytes,
        "uploaded_by": image.uploaded_by,
        "uploaded_at": image.uploaded_at.isoformat(),
        "folder_id": image.folder_id,
        "folder_name": folder.name if folder else "",
        "url": f"/api/v1/therapy/material-images/{image.filename}",
    }


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

    @field_validator("title", "location", mode="before")
    @classmethod
    def trim_required_text(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

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


class TherapyMaterialCreatePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=2, max_length=120)
    category: str = Field(min_length=2, max_length=40)
    unit: str = Field(min_length=1, max_length=24)
    initial_quantity: Decimal = Field(default=Decimal(0), ge=0, max_digits=12, decimal_places=3)
    color_name: str = Field(default="", max_length=60)
    color_code: str = Field(default="", max_length=32)

    @field_validator("name", "category", "unit", "color_name", "color_code", mode="before")
    @classmethod
    def trim_text(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class TherapyMaterialUpdatePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=2, max_length=120)
    category: str = Field(min_length=2, max_length=40)
    unit: str = Field(min_length=1, max_length=24)
    color_name: str = Field(default="", max_length=60)
    color_code: str = Field(default="", max_length=32)
    active: bool

    @field_validator("name", "category", "unit", "color_name", "color_code", mode="before")
    @classmethod
    def trim_text(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class TherapyMaterialAdjustmentPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    direction: Literal["entrada", "consumo"]
    quantity: Decimal = Field(gt=0, max_digits=12, decimal_places=3)
    reason: str = Field(min_length=3, max_length=300)

    @field_validator("reason", mode="before")
    @classmethod
    def trim_reason(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


@app.get("/health")
def health() -> dict[str, str]:
    return {"service": "therapy", "status": "ok"}


@app.get("/api/v1/therapy/materials")
def list_therapy_materials(
    principal: Annotated[DemoPrincipal, Depends(THERAPY_REPORT_ACCESS)],
    db: Annotated[Session, Depends(get_therapy_db)],
    include_archived: bool = False,
) -> dict[str, list[dict[str, object]]]:
    query = select(TherapyMaterial)
    if not include_archived:
        query = query.where(TherapyMaterial.active.is_(True))
    materials = db.scalars(query.order_by(TherapyMaterial.category, TherapyMaterial.name)).all()
    emit_audit_event(principal, "therapy", "therapy_materials_read", "therapy_materials")
    return {"materials": [serialize_material(material) for material in materials]}


@app.post("/api/v1/therapy/materials", status_code=201)
def create_therapy_material(
    payload: TherapyMaterialCreatePayload,
    principal: Annotated[DemoPrincipal, Depends(THERAPY_ROLE)],
    db: Annotated[Session, Depends(get_therapy_db)],
) -> dict[str, object]:
    now = datetime.now(UTC)
    material = TherapyMaterial(
        id=str(uuid.uuid4()),
        name=payload.name,
        category=payload.category,
        unit=payload.unit,
        quantity=payload.initial_quantity,
        color_name=payload.color_name,
        color_code=payload.color_code,
        active=True,
        created_by=principal.actor_name,
        created_at=now,
        updated_at=now,
    )
    db.add(material)
    if payload.initial_quantity > 0:
        db.add(
            TherapyMaterialMovement(
                id=str(uuid.uuid4()),
                material_id=material.id,
                direction="entrada",
                quantity=payload.initial_quantity,
                balance_after=payload.initial_quantity,
                reason="Saldo inicial do cadastro",
                actor_id=principal.user_id,
                actor_name=principal.actor_name,
                created_at=now,
            )
        )
    emit_audit_event(principal, "therapy", "therapy_material_created", material.id, db=db)
    db.commit()
    db.refresh(material)
    return serialize_material(material)


@app.patch("/api/v1/therapy/materials/{material_id}")
def update_therapy_material(
    material_id: str,
    payload: TherapyMaterialUpdatePayload,
    principal: Annotated[DemoPrincipal, Depends(THERAPY_ROLE)],
    db: Annotated[Session, Depends(get_therapy_db)],
) -> dict[str, object]:
    material = db.scalar(
        select(TherapyMaterial).where(TherapyMaterial.id == material_id).with_for_update()
    )
    if material is None:
        raise HTTPException(status_code=404, detail="Material não encontrado")
    material.name = payload.name
    material.category = payload.category
    material.unit = payload.unit
    material.color_name = payload.color_name
    material.color_code = payload.color_code
    material.active = payload.active
    material.updated_at = datetime.now(UTC)
    emit_audit_event(principal, "therapy", "therapy_material_updated", material.id, db=db)
    db.commit()
    db.refresh(material)
    return serialize_material(material)


@app.post("/api/v1/therapy/materials/{material_id}/movements", status_code=201)
def create_therapy_material_movement(
    material_id: str,
    payload: TherapyMaterialAdjustmentPayload,
    principal: Annotated[DemoPrincipal, Depends(THERAPY_ROLE)],
    db: Annotated[Session, Depends(get_therapy_db)],
) -> dict[str, object]:
    material = db.scalar(
        select(TherapyMaterial).where(TherapyMaterial.id == material_id).with_for_update()
    )
    if material is None:
        raise HTTPException(status_code=404, detail="Material não encontrado")
    if not material.active:
        raise HTTPException(status_code=409, detail="Reative o material antes de movimentar o estoque")
    change = payload.quantity if payload.direction == "entrada" else -payload.quantity
    balance = material.quantity + change
    if balance < 0:
        raise HTTPException(status_code=409, detail="O consumo não pode deixar o estoque negativo")
    if balance > Decimal("999999999.999"):
        raise HTTPException(status_code=409, detail="A quantidade excede o limite permitido para o estoque")
    now = datetime.now(UTC)
    material.quantity = balance
    material.updated_at = now
    movement = TherapyMaterialMovement(
        id=str(uuid.uuid4()),
        material_id=material.id,
        direction=payload.direction,
        quantity=payload.quantity,
        balance_after=balance,
        reason=payload.reason,
        actor_id=principal.user_id,
        actor_name=principal.actor_name,
        created_at=now,
    )
    db.add(movement)
    emit_audit_event(principal, "therapy", "therapy_material_movement_created", material.id, db=db)
    db.commit()
    db.refresh(material)
    return {
        "material": serialize_material(material),
        "movement": {
            "id": movement.id,
            "direction": movement.direction,
            "quantity": str(movement.quantity),
            "balance_after": str(movement.balance_after),
            "reason": movement.reason,
            "actor_name": movement.actor_name,
            "created_at": movement.created_at.isoformat(),
        },
    }


@app.get("/api/v1/therapy/materials/{material_id}/movements")
def list_therapy_material_movements(
    material_id: str,
    principal: Annotated[DemoPrincipal, Depends(THERAPY_REPORT_ACCESS)],
    db: Annotated[Session, Depends(get_therapy_db)],
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> dict[str, object]:
    if db.get(TherapyMaterial, material_id) is None:
        raise HTTPException(status_code=404, detail="Material não encontrado")
    total = db.scalar(
        select(func.count()).select_from(TherapyMaterialMovement).where(
            TherapyMaterialMovement.material_id == material_id
        )
    ) or 0
    movements = db.scalars(
        select(TherapyMaterialMovement)
        .where(TherapyMaterialMovement.material_id == material_id)
        .order_by(TherapyMaterialMovement.created_at.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    emit_audit_event(principal, "therapy", "therapy_material_movements_read", material_id)
    return {
        "movements": [
            {
                "id": movement.id,
                "direction": movement.direction,
                "quantity": str(movement.quantity),
                "balance_after": str(movement.balance_after),
                "reason": movement.reason,
                "actor_name": movement.actor_name,
                "created_at": movement.created_at.isoformat(),
            }
            for movement in movements
        ],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@app.get("/api/v1/therapy/material-images")
def list_therapy_material_images(
    principal: Annotated[DemoPrincipal, Depends(THERAPY_REPORT_ACCESS)],
    db: Annotated[Session, Depends(get_therapy_db)],
) -> dict[str, list[dict[str, object]]]:
    images = db.scalars(
        select(TherapyMaterialImage).order_by(TherapyMaterialImage.title, TherapyMaterialImage.uploaded_at.desc())
    ).all()
    folders = db.scalars(
        select(TherapyMaterialImageFolder).order_by(TherapyMaterialImageFolder.name)
    ).all()
    folders_by_id = {folder.id: folder for folder in folders}
    emit_audit_event(principal, "therapy", "therapy_material_images_read", "therapy_material_images")
    return {
        "images": [serialize_material_image(image, folders_by_id.get(image.folder_id or "")) for image in images],
        "folders": [serialize_material_image_folder(folder, db) for folder in folders],
    }


def serialize_material_image_folder(
    folder: TherapyMaterialImageFolder,
    db: Session,
) -> dict[str, object]:
    image_count = db.scalar(
        select(func.count()).select_from(TherapyMaterialImage).where(
            TherapyMaterialImage.folder_id == folder.id
        )
    ) or 0
    return {
        "id": folder.id,
        "name": folder.name,
        "image_count": image_count,
        "created_by": folder.created_by,
        "created_at": folder.created_at.isoformat(),
    }


@app.post("/api/v1/therapy/material-images/folders", status_code=201)
def create_therapy_material_image_folder(
    payload: TherapyMaterialImageFolderPayload,
    principal: Annotated[DemoPrincipal, Depends(THERAPY_ROLE)],
    db: Annotated[Session, Depends(get_therapy_db)],
) -> dict[str, object]:
    folder_name = payload.name.casefold()
    existing_folders = db.scalars(select(TherapyMaterialImageFolder)).all()
    if any(folder.name.casefold() == folder_name for folder in existing_folders):
        raise HTTPException(status_code=409, detail="Já existe uma pasta com esse nome")
    folder = TherapyMaterialImageFolder(
        id=str(uuid.uuid4()),
        name=payload.name,
        created_by=principal.actor_name,
        created_at=datetime.now(UTC),
    )
    db.add(folder)
    emit_audit_event(principal, "therapy", "therapy_material_image_folder_created", folder.id, db=db)
    db.commit()
    db.refresh(folder)
    return serialize_material_image_folder(folder, db)


@app.patch("/api/v1/therapy/material-images/folders/{folder_id}")
def rename_therapy_material_image_folder(
    folder_id: str,
    payload: TherapyMaterialImageFolderPayload,
    principal: Annotated[DemoPrincipal, Depends(THERAPY_ROLE)],
    db: Annotated[Session, Depends(get_therapy_db)],
) -> dict[str, object]:
    folder = db.get(TherapyMaterialImageFolder, folder_id)
    if folder is None:
        raise HTTPException(status_code=404, detail="Pasta não encontrada")
    folder_name = payload.name.casefold()
    duplicate = db.scalars(select(TherapyMaterialImageFolder).where(
        TherapyMaterialImageFolder.id != folder_id
    )).all()
    if any(item.name.casefold() == folder_name for item in duplicate):
        raise HTTPException(status_code=409, detail="Já existe uma pasta com esse nome")
    folder.name = payload.name
    emit_audit_event(principal, "therapy", "therapy_material_image_folder_renamed", folder.id, db=db)
    db.commit()
    db.refresh(folder)
    return serialize_material_image_folder(folder, db)


@app.delete("/api/v1/therapy/material-images/folders/{folder_id}", status_code=204)
def delete_therapy_material_image_folder(
    folder_id: str,
    principal: Annotated[DemoPrincipal, Depends(THERAPY_ROLE)],
    db: Annotated[Session, Depends(get_therapy_db)],
) -> Response:
    folder = db.get(TherapyMaterialImageFolder, folder_id)
    if folder is None:
        raise HTTPException(status_code=404, detail="Pasta não encontrada")
    image_count = db.scalar(
        select(func.count()).select_from(TherapyMaterialImage).where(
            TherapyMaterialImage.folder_id == folder.id
        )
    ) or 0
    if image_count:
        raise HTTPException(status_code=409, detail="Mova ou exclua as imagens antes de excluir a pasta")
    emit_audit_event(principal, "therapy", "therapy_material_image_folder_deleted", folder.id, db=db)
    db.delete(folder)
    db.commit()
    return Response(status_code=204)


@app.patch("/api/v1/therapy/material-images/{image_id}")
def update_therapy_material_image(
    image_id: str,
    payload: TherapyMaterialImageUpdatePayload,
    principal: Annotated[DemoPrincipal, Depends(THERAPY_ROLE)],
    db: Annotated[Session, Depends(get_therapy_db)],
) -> dict[str, object]:
    image = db.get(TherapyMaterialImage, image_id)
    if image is None:
        raise HTTPException(status_code=404, detail="Imagem não encontrada")
    if "title" in payload.model_fields_set and payload.title is not None:
        image.title = payload.title
    if "folder_id" in payload.model_fields_set:
        if payload.folder_id is not None and db.get(TherapyMaterialImageFolder, payload.folder_id) is None:
            raise HTTPException(status_code=404, detail="Pasta não encontrada")
        image.folder_id = payload.folder_id
    emit_audit_event(principal, "therapy", "therapy_material_image_updated", image.id, db=db)
    db.commit()
    db.refresh(image)
    folder = db.get(TherapyMaterialImageFolder, image.folder_id) if image.folder_id else None
    return serialize_material_image(image, folder)


@app.post("/api/v1/therapy/material-images", status_code=201)
async def upload_therapy_material_image(
    request: Request,
    title: Annotated[str, Query(min_length=2, max_length=120)],
    principal: Annotated[DemoPrincipal, Depends(THERAPY_ROLE)],
    db: Annotated[Session, Depends(get_therapy_db)],
    folder_id: str | None = None,
) -> dict[str, object]:
    title = title.strip()
    if len(title) < 2:
        raise HTTPException(status_code=422, detail="Informe um título com pelo menos 2 caracteres")
    content_type = request.headers.get("content-type", "").split(";", maxsplit=1)[0].strip().lower()
    extension = MATERIAL_IMAGE_TYPES.get(content_type)
    if extension is None:
        raise HTTPException(status_code=415, detail="Formato não aceito. Envie JPG, PNG ou WebP.")
    content = bytearray()
    async for chunk in request.stream():
        content.extend(chunk)
        if len(content) > MATERIAL_IMAGE_MAX_BYTES:
            raise HTTPException(status_code=413, detail="Cada imagem deve ter no máximo 12 MB.")
    if not valid_material_image(content_type, content):
        raise HTTPException(status_code=422, detail="O arquivo não corresponde a uma imagem válida do formato informado.")
    if folder_id is not None and db.get(TherapyMaterialImageFolder, folder_id) is None:
        raise HTTPException(status_code=404, detail="Pasta não encontrada")
    filename = f"{uuid.uuid4().hex}{extension}"
    image_path = therapy_materials_directory() / filename
    image = TherapyMaterialImage(
        id=str(uuid.uuid4()),
        filename=filename,
        title=title,
        content_type=content_type,
        size_bytes=len(content),
        uploaded_by=principal.actor_name,
        uploaded_at=datetime.now(UTC),
        folder_id=folder_id,
    )
    try:
        image_path.parent.mkdir(parents=True, exist_ok=True)
        image_path.write_bytes(content)
        db.add(image)
        emit_audit_event(principal, "therapy", "therapy_material_image_uploaded", image.id, db=db)
        db.commit()
    except Exception:
        db.rollback()
        try:
            image_path.unlink(missing_ok=True)
        except OSError as cleanup_error:
            raise RuntimeError("Não foi possível finalizar ou limpar o upload da imagem.") from cleanup_error
        raise
    folder = db.get(TherapyMaterialImageFolder, image.folder_id) if image.folder_id else None
    return serialize_material_image(image, folder)


@app.get("/api/v1/therapy/material-images/{filename}")
def get_therapy_material_image(
    filename: str,
    principal: Annotated[DemoPrincipal, Depends(THERAPY_REPORT_ACCESS)],
    db: Annotated[Session, Depends(get_therapy_db)],
) -> FileResponse:
    if not re.fullmatch(r"[a-f0-9]{32}\.(?:jpg|png|webp)", filename):
        raise HTTPException(status_code=404, detail="Imagem não encontrada")
    image = db.scalar(select(TherapyMaterialImage).where(TherapyMaterialImage.filename == filename))
    if image is None:
        raise HTTPException(status_code=404, detail="Imagem não encontrada")
    image_path = therapy_materials_directory() / filename
    if not image_path.is_file():
        raise HTTPException(status_code=500, detail="Arquivo da biblioteca não está disponível no armazenamento")
    emit_audit_event(principal, "therapy", "therapy_material_image_downloaded", image.id)
    return FileResponse(
        image_path,
        media_type=image.content_type,
        headers={
            "Cache-Control": "private, no-store",
            "Content-Disposition": f'inline; filename="{image.id}{image_path.suffix}"',
            "X-Content-Type-Options": "nosniff",
        },
    )


@app.delete("/api/v1/therapy/material-images/{image_id}", status_code=204)
def delete_therapy_material_image(
    image_id: str,
    principal: Annotated[DemoPrincipal, Depends(THERAPY_ROLE)],
    db: Annotated[Session, Depends(get_therapy_db)],
) -> Response:
    image = db.get(TherapyMaterialImage, image_id)
    if image is None:
        raise HTTPException(status_code=404, detail="Imagem não encontrada")
    image_path = therapy_materials_directory() / image.filename
    if not image_path.is_file():
        raise HTTPException(status_code=500, detail="Arquivo da biblioteca não está disponível no armazenamento")
    content = image_path.read_bytes()
    image_path.unlink()
    db.delete(image)
    try:
        emit_audit_event(principal, "therapy", "therapy_material_image_deleted", image.id, db=db)
        db.commit()
    except Exception:
        db.rollback()
        try:
            image_path.write_bytes(content)
        except OSError as restore_error:
            raise RuntimeError("A exclusão falhou e não foi possível restaurar a imagem; contate o suporte.") from restore_error
        raise
    return Response(status_code=204)


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
