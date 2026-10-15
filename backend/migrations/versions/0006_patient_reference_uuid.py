"""Allow the full opaque UUID used as a patient reference."""

import os

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect


revision = "0006_patient_ref"
down_revision = "0005_nursing_author"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return
    inspector = inspect(op.get_bind())
    for table, column in (("patients", "reference"), ("vital_records", "patient_reference")):
        current = next(item["type"] for item in inspector.get_columns(table) if item["name"] == column)
        if getattr(current, "length", None) != 36:
            with op.batch_alter_table(table) as batch:
                batch.alter_column(
                    column,
                    existing_type=sa.String(32),
                    type_=sa.String(36),
                    existing_nullable=False,
                )


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return
    # UUID references cannot be safely truncated to the previous width.
