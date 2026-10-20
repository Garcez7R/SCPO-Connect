"""Add the reception appointment schedule."""

import os

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0036_reception_appointments"
down_revision = "0035_interprofessional_shares"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return

    inspector = inspect(op.get_bind())
    if "reception_appointments" not in inspector.get_table_names():
        op.create_table(
            "reception_appointments",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "patient_reference",
                sa.String(36),
                sa.ForeignKey("patients.reference", ondelete="RESTRICT"),
                nullable=False,
            ),
            sa.Column("appointment_type", sa.String(16), nullable=False),
            sa.Column("professional_name", sa.String(120), nullable=False),
            sa.Column("location", sa.String(120), nullable=False),
            sa.Column("purpose", sa.String(300), nullable=False, server_default=""),
            sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("status", sa.String(16), nullable=False, server_default="scheduled"),
            sa.Column("created_by", sa.String(36), nullable=False),
            sa.Column("created_by_name", sa.String(120), nullable=False),
            sa.Column("updated_by_name", sa.String(120), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index(
            "ix_reception_appointments_patient_start",
            "reception_appointments",
            ["patient_reference", "starts_at"],
        )
        op.create_index(
            "ix_reception_appointments_status_start",
            "reception_appointments",
            ["status", "starts_at"],
        )


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return

    inspector = inspect(op.get_bind())
    if "reception_appointments" in inspector.get_table_names():
        indexes = {index["name"] for index in inspector.get_indexes("reception_appointments")}
        for name in ("ix_reception_appointments_status_start", "ix_reception_appointments_patient_start"):
            if name in indexes:
                op.drop_index(name, table_name="reception_appointments")
        op.drop_table("reception_appointments")
