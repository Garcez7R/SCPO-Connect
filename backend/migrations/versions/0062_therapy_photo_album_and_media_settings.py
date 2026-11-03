"""Add independent therapy photo album and media controls."""

import os
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0062_therapy_album"
down_revision = "0061_system_module_settings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return

    bind = op.get_bind()
    existing = set(inspect(bind).get_table_names())
    if "therapy_photo_album_folders" not in existing:
        op.create_table(
            "therapy_photo_album_folders",
            sa.Column("id", sa.String(length=36), primary_key=True),
            sa.Column("name", sa.String(length=80), nullable=False),
            sa.Column("created_by", sa.String(length=120), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.UniqueConstraint("name", name="uq_therapy_photo_album_folders_name"),
        )
    existing = set(inspect(bind).get_table_names())
    if "therapy_photo_album_images" not in existing:
        op.create_table(
            "therapy_photo_album_images",
            sa.Column("id", sa.String(length=36), primary_key=True),
            sa.Column("filename", sa.String(length=48), nullable=False, unique=True),
            sa.Column("title", sa.String(length=120), nullable=False),
            sa.Column("content_type", sa.String(length=24), nullable=False),
            sa.Column("size_bytes", sa.Integer(), nullable=False),
            sa.Column("uploaded_by", sa.String(length=120), nullable=False),
            sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("folder_id", sa.String(length=36), nullable=True),
            sa.ForeignKeyConstraint(
                ["folder_id"],
                ["therapy_photo_album_folders.id"],
                name="fk_therapy_photo_album_images_folder_id",
                ondelete="RESTRICT",
            ),
        )
    if "therapy_media_settings" not in existing:
        op.create_table(
            "therapy_media_settings",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("library_enabled", sa.Boolean(), nullable=False),
            sa.Column("album_enabled", sa.Boolean(), nullable=False),
            sa.Column("library_quota_bytes", sa.BigInteger(), nullable=True),
            sa.Column("album_quota_bytes", sa.BigInteger(), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_by_id", sa.String(length=36), nullable=False),
            sa.Column("updated_by_name", sa.String(length=120), nullable=False),
        )
        op.bulk_insert(
            sa.table(
                "therapy_media_settings",
                sa.column("id", sa.Integer()),
                sa.column("library_enabled", sa.Boolean()),
                sa.column("album_enabled", sa.Boolean()),
                sa.column("library_quota_bytes", sa.BigInteger()),
                sa.column("album_quota_bytes", sa.BigInteger()),
                sa.column("updated_at", sa.DateTime(timezone=True)),
                sa.column("updated_by_id", sa.String(length=36)),
                sa.column("updated_by_name", sa.String(length=120)),
            ),
            [
                {
                    "id": 1,
                    "library_enabled": True,
                    "album_enabled": True,
                    "library_quota_bytes": None,
                    "album_quota_bytes": None,
                    "updated_at": datetime.now(UTC),
                    "updated_by_id": "system",
                    "updated_by_name": "Instalação inicial",
                }
            ],
        )


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return

    existing = set(inspect(op.get_bind()).get_table_names())
    if "therapy_media_settings" in existing:
        op.drop_table("therapy_media_settings")
    if "therapy_photo_album_images" in existing:
        op.drop_table("therapy_photo_album_images")
    if "therapy_photo_album_folders" in existing:
        op.drop_table("therapy_photo_album_folders")
