"""Add the hospital chart number to the canonical patient profile."""

import os

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0038_patient_same_number"
down_revision = "0037_hygiene_bed_turnover"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return

    inspector = inspect(op.get_bind())
    if "patients" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("patients")}
    if "same_number" not in columns:
        op.add_column(
            "patients",
            sa.Column("same_number", sa.String(40), nullable=False, server_default=""),
        )


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return

    inspector = inspect(op.get_bind())
    if "patients" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("patients")}
    if "same_number" in columns:
        op.drop_column("patients", "same_number")
