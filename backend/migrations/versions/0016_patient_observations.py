"""Add auditable follow-up notes and attention level for patient history."""

import os

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect


revision = "0016_patient_observations"
down_revision = "0015_pharmacy_active_ingredient"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return
    if "patient_observations" not in inspect(op.get_bind()).get_table_names():
        op.create_table(
            "patient_observations",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("patient_reference", sa.String(36), sa.ForeignKey("patients.reference", ondelete="RESTRICT"), nullable=False),
            sa.Column("attention_level", sa.String(12), nullable=False),
            sa.Column("observation", sa.String(2000), nullable=False),
            sa.Column("treatment_status", sa.String(24), nullable=False, server_default="in_progress"),
            sa.Column("actor_id", sa.String(36), nullable=False),
            sa.Column("actor_name", sa.String(120), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index("ix_patient_observations_patient_date", "patient_observations", ["patient_reference", "created_at"])


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return
    if "patient_observations" in inspect(op.get_bind()).get_table_names():
        op.drop_index("ix_patient_observations_patient_date", table_name="patient_observations")
        op.drop_table("patient_observations")
