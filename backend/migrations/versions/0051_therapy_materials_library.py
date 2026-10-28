"""Add auditable therapy inventory and printable image library."""

import os

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0051_therapy_materials_library"
down_revision = "0050_laboratory_request_groups"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return

    bind = op.get_bind()
    existing = set(inspect(bind).get_table_names())
    if "therapy_materials" not in existing:
        op.create_table(
            "therapy_materials",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("name", sa.String(120), nullable=False),
            sa.Column("category", sa.String(40), nullable=False),
            sa.Column("unit", sa.String(24), nullable=False),
            sa.Column("quantity", sa.Numeric(12, 3), nullable=False),
            sa.Column("color_name", sa.String(60), nullable=False, server_default=""),
            sa.Column("color_code", sa.String(32), nullable=False, server_default=""),
            sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_by", sa.String(120), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint("quantity >= 0", name="ck_therapy_materials_quantity_nonnegative"),
        )
    existing = set(inspect(bind).get_table_names())
    if "therapy_material_movements" not in existing:
        op.create_table(
            "therapy_material_movements",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "material_id",
                sa.String(36),
                sa.ForeignKey("therapy_materials.id", ondelete="RESTRICT"),
                nullable=False,
            ),
            sa.Column("direction", sa.String(12), nullable=False),
            sa.Column("quantity", sa.Numeric(12, 3), nullable=False),
            sa.Column("balance_after", sa.Numeric(12, 3), nullable=False),
            sa.Column("reason", sa.String(300), nullable=False),
            sa.Column("actor_id", sa.String(36), nullable=False),
            sa.Column("actor_name", sa.String(120), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint("quantity > 0", name="ck_therapy_material_movements_quantity_positive"),
            sa.CheckConstraint("balance_after >= 0", name="ck_therapy_material_movements_balance_nonnegative"),
        )
        op.create_index(
            "ix_therapy_material_movements_material_created",
            "therapy_material_movements",
            ["material_id", "created_at"],
        )
    if "therapy_material_images" not in existing:
        op.create_table(
            "therapy_material_images",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("filename", sa.String(48), nullable=False, unique=True),
            sa.Column("title", sa.String(120), nullable=False),
            sa.Column("content_type", sa.String(24), nullable=False),
            sa.Column("size_bytes", sa.Integer(), nullable=False),
            sa.Column("uploaded_by", sa.String(120), nullable=False),
            sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=False),
        )


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return

    bind = op.get_bind()
    existing = set(inspect(bind).get_table_names())
    if "therapy_material_images" in existing:
        op.drop_table("therapy_material_images")
    if "therapy_material_movements" in existing:
        op.drop_index(
            "ix_therapy_material_movements_material_created",
            table_name="therapy_material_movements",
        )
        op.drop_table("therapy_material_movements")
    if "therapy_materials" in existing:
        op.drop_table("therapy_materials")
