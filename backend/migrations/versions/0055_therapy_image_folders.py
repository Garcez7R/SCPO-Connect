"""Add folders to the therapy image library."""

import os

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0055_therapy_image_folders"
down_revision = "0054_physician_profile_outbox"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return

    bind = op.get_bind()
    existing = set(inspect(bind).get_table_names())
    if "therapy_material_image_folders" not in existing:
        op.create_table(
            "therapy_material_image_folders",
            sa.Column("id", sa.String(length=36), primary_key=True),
            sa.Column("name", sa.String(length=80), nullable=False, unique=True),
            sa.Column("created_by", sa.String(length=120), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )

    if "therapy_material_images" in existing:
        columns = {column["name"] for column in inspect(bind).get_columns("therapy_material_images")}
        if "folder_id" not in columns:
            with op.batch_alter_table("therapy_material_images") as batch_op:
                batch_op.add_column(
                    sa.Column(
                        "folder_id",
                        sa.String(length=36),
                        sa.ForeignKey(
                            "therapy_material_image_folders.id",
                            name="fk_therapy_material_images_folder_id",
                            ondelete="RESTRICT",
                        ),
                        nullable=True,
                    )
                )
                batch_op.create_index(
                    "ix_therapy_material_images_folder_id",
                    ["folder_id"],
                )


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return

    bind = op.get_bind()
    existing = set(inspect(bind).get_table_names())
    if "therapy_material_images" in existing:
        columns = {column["name"] for column in inspect(bind).get_columns("therapy_material_images")}
        if "folder_id" in columns:
            with op.batch_alter_table("therapy_material_images") as batch_op:
                batch_op.drop_index("ix_therapy_material_images_folder_id")
                batch_op.drop_column("folder_id")
    if "therapy_material_image_folders" in existing:
        op.drop_table("therapy_material_image_folders")
