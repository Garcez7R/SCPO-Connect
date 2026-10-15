"""Add searchable patient CPF and nutrition assessments."""

import os

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect


revision = "0010_patient_cpf_nutrition"
down_revision = "0009_therapy_reports"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return
    columns = {column["name"] for column in inspect(op.get_bind()).get_columns("patients")}
    if "cpf" not in columns:
        op.add_column("patients", sa.Column("cpf", sa.String(11), nullable=False, server_default=""))
    if not inspect(op.get_bind()).has_table("nutrition_records"):
        op.create_table(
            "nutrition_records",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("patient_reference", sa.String(36), nullable=False, index=True),
            sa.Column("assessment_date", sa.Date(), nullable=False),
            sa.Column("weight_kg", sa.String(12), nullable=False, server_default=""),
            sa.Column("height_cm", sa.String(12), nullable=False, server_default=""),
            sa.Column("diet_type", sa.String(80), nullable=False, server_default=""),
            sa.Column("allergies", sa.String(500), nullable=False, server_default=""),
            sa.Column("restrictions", sa.String(500), nullable=False, server_default=""),
            sa.Column("appetite", sa.String(40), nullable=False, server_default=""),
            sa.Column("hydration", sa.String(40), nullable=False, server_default=""),
            sa.Column("notes", sa.Text(), nullable=False, server_default=""),
            sa.Column("actor_id", sa.String(36), nullable=False),
            sa.Column("actor_name", sa.String(120), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return
    op.drop_table("nutrition_records")
    op.drop_column("patients", "cpf")
