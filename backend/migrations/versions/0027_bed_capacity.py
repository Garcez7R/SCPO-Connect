"""Model hospital units, beds, and auditable patient assignments."""

import os

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0027_bed_capacity"
down_revision = "0026_system_admin"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return

    bind = op.get_bind()
    tables = set(inspect(bind).get_table_names())
    if "hospital_units" not in tables:
        op.create_table(
            "hospital_units",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("name", sa.String(100), nullable=False, unique=True),
            sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("created_by", sa.String(120), nullable=False),
        )
    if "hospital_beds" not in tables:
        op.create_table(
            "hospital_beds",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "unit_id",
                sa.String(36),
                sa.ForeignKey("hospital_units.id", ondelete="RESTRICT"),
                nullable=False,
            ),
            sa.Column("room", sa.String(20), nullable=False),
            sa.Column("label", sa.String(20), nullable=False),
            sa.Column("status", sa.String(20), nullable=False, server_default="available"),
            sa.Column("isolation_capable", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("notes", sa.String(300), nullable=False, server_default=""),
            sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("created_by", sa.String(120), nullable=False),
            sa.UniqueConstraint("unit_id", "room", "label", name="uq_hospital_beds_unit_room_label"),
        )
    if "bed_assignments" not in tables:
        op.create_table(
            "bed_assignments",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "bed_id",
                sa.String(36),
                sa.ForeignKey("hospital_beds.id", ondelete="RESTRICT"),
                nullable=False,
            ),
            sa.Column(
                "patient_reference",
                sa.String(36),
                sa.ForeignKey("patients.reference", ondelete="RESTRICT"),
                nullable=False,
            ),
            sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("assigned_by", sa.String(120), nullable=False),
            sa.Column("released_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("released_by", sa.String(120), nullable=False, server_default=""),
        )
        op.create_index(
            "uq_bed_assignments_active_bed",
            "bed_assignments",
            ["bed_id"],
            unique=True,
            sqlite_where=sa.text("released_at IS NULL"),
            postgresql_where=sa.text("released_at IS NULL"),
        )
        op.create_index(
            "uq_bed_assignments_active_patient",
            "bed_assignments",
            ["patient_reference"],
            unique=True,
            sqlite_where=sa.text("released_at IS NULL"),
            postgresql_where=sa.text("released_at IS NULL"),
        )
        op.create_index(
            "ix_bed_assignments_patient_assigned",
            "bed_assignments",
            ["patient_reference", "assigned_at"],
        )


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return

    op.drop_index("ix_bed_assignments_patient_assigned", table_name="bed_assignments")
    op.drop_index("uq_bed_assignments_active_patient", table_name="bed_assignments")
    op.drop_index("uq_bed_assignments_active_bed", table_name="bed_assignments")
    op.drop_table("bed_assignments")
    op.drop_table("hospital_beds")
    op.drop_table("hospital_units")
