"""Record scheduled medication administrations by prescription and time."""

import os

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0046_scheduled_medication_administrations"
down_revision = "0045_reception_queue_calls"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return

    tables = set(inspect(op.get_bind()).get_table_names())
    if "scheduled_medication_administrations" in tables:
        return
    if not {"patients", "physician_prescriptions"}.issubset(tables):
        return

    op.create_table(
        "scheduled_medication_administrations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "prescription_reference",
            sa.String(length=36),
            sa.ForeignKey("physician_prescriptions.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "patient_reference",
            sa.String(length=36),
            sa.ForeignKey("patients.reference", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("scheduled_date", sa.Date(), nullable=False),
        sa.Column("scheduled_time", sa.String(length=5), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("reason", sa.String(length=500), nullable=False, server_default=""),
        sa.Column("actor_id", sa.String(length=36), nullable=False),
        sa.Column("actor_name", sa.String(length=120), nullable=False),
        sa.Column(
            "recorded_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.UniqueConstraint(
            "prescription_reference",
            "scheduled_date",
            "scheduled_time",
            name="uq_scheduled_med_admin_prescription_date_time",
        ),
    )
    op.create_index(
        "ix_scheduled_medication_administrations_patient_reference",
        "scheduled_medication_administrations",
        ["patient_reference"],
    )
    op.create_index(
        "ix_scheduled_med_admin_date_time",
        "scheduled_medication_administrations",
        ["scheduled_date", "scheduled_time"],
    )


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return
    tables = set(inspect(op.get_bind()).get_table_names())
    if "scheduled_medication_administrations" in tables:
        op.drop_table("scheduled_medication_administrations")
