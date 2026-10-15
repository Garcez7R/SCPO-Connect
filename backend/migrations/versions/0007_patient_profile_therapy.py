"""Expand the shared patient profile."""

import os

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect


revision = "0007_patient_therapy"
down_revision = "0006_patient_ref"
branch_labels = None
depends_on = None


def upgrade() -> None:
    service = os.getenv("SCPO_SERVICE")
    if service == "nursing":
        columns = (
            ("birth_date", sa.Date(), True),
            ("sex", sa.String(24), False),
            ("phone", sa.String(40), False),
            ("email", sa.String(160), False),
            ("address", sa.String(180), False),
            ("address_number", sa.String(24), False),
            ("address_complement", sa.String(100), False),
            ("neighborhood", sa.String(100), False),
            ("city", sa.String(100), False),
            ("state", sa.String(2), False),
            ("postal_code", sa.String(12), False),
            ("responsible_name", sa.String(120), False),
            ("responsible_relationship", sa.String(60), False),
            ("responsible_phone", sa.String(40), False),
            ("responsible_address", sa.String(180), False),
            ("responsible_address_number", sa.String(24), False),
            ("responsible_address_complement", sa.String(100), False),
            ("responsible_neighborhood", sa.String(100), False),
            ("responsible_city", sa.String(100), False),
            ("responsible_state", sa.String(2), False),
            ("responsible_postal_code", sa.String(12), False),
            ("photo_data", sa.Text(), False),
            ("created_at", sa.DateTime(timezone=True), True),
            ("updated_at", sa.DateTime(timezone=True), True),
            ("updated_by", sa.String(120), False),
        )
        existing_columns = {column["name"] for column in inspect(op.get_bind()).get_columns("patients")}
        for name, column_type, nullable in columns:
            if name not in existing_columns:
                op.add_column("patients", sa.Column(name, column_type, nullable=nullable, server_default="" if not nullable and name not in {"created_at", "updated_at", "birth_date"} else None))


def downgrade() -> None:
    service = os.getenv("SCPO_SERVICE")
    if service == "nursing":
        for name in ("updated_by", "updated_at", "created_at", "photo_data", "responsible_postal_code", "responsible_state", "responsible_city", "responsible_neighborhood", "responsible_address_complement", "responsible_address_number", "responsible_address", "responsible_phone", "responsible_relationship", "responsible_name", "postal_code", "state", "city", "neighborhood", "address_complement", "address_number", "address", "email", "phone", "sex", "birth_date"):
            op.drop_column("patients", name)
