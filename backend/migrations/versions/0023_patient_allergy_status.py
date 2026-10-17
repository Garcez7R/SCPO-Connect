"""Add explicit allergy and responsible-party statuses to patient records."""

import os

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0023_patient_allergy_status"
down_revision = "0022_stock_movements_emergency_arrivals"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return
    columns = {column["name"] for column in inspect(op.get_bind()).get_columns("patients")}
    if "allergies_status" not in columns:
        op.add_column(
            "patients",
            sa.Column(
                "allergies_status",
                sa.String(16),
                nullable=False,
                server_default="unknown",
            ),
        )
        op.execute(
            sa.text(
                "UPDATE patients SET allergies_status = CASE "
                "WHEN trim(allergies) != '' THEN 'known' ELSE 'unknown' END"
            )
        )
    if "responsible_status" not in columns:
        op.add_column(
            "patients",
            sa.Column(
                "responsible_status",
                sa.String(16),
                nullable=False,
                server_default="unknown",
            ),
        )
        op.execute(
            sa.text(
                "UPDATE patients SET responsible_status = CASE "
                "WHEN trim(responsible_name) != '' THEN 'provided' ELSE 'unknown' END"
            )
        )


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return
    columns = {column["name"] for column in inspect(op.get_bind()).get_columns("patients")}
    if "responsible_status" in columns:
        op.drop_column("patients", "responsible_status")
    if "allergies_status" in columns:
        op.drop_column("patients", "allergies_status")
