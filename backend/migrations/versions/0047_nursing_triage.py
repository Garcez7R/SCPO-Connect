"""Persist encounter-specific nursing triage snapshots."""

import os

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0047_nursing_triage"
down_revision = "0046_scheduled_med_admins"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return

    tables = set(inspect(op.get_bind()).get_table_names())
    if "nursing_triages" in tables:
        return
    if not {"emergency_arrivals", "patients"}.issubset(tables):
        return

    op.create_table(
        "nursing_triages",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "arrival_id",
            sa.String(length=36),
            sa.ForeignKey("emergency_arrivals.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "patient_reference",
            sa.String(length=36),
            sa.ForeignKey("patients.reference", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("allergies_status", sa.String(length=16), nullable=False),
        sa.Column("allergies", sa.String(length=1000), nullable=False, server_default=""),
        sa.Column("conditions_treatments", sa.Text(), nullable=False, server_default=""),
        sa.Column("vital_values", sa.JSON(), nullable=False),
        sa.Column("glucose_unit", sa.String(length=12), nullable=False, server_default="mg/dL"),
        sa.Column("measured_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("actor_id", sa.String(length=36), nullable=False),
        sa.Column("actor_name", sa.String(length=120), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )
    op.create_index(
        "ix_nursing_triages_arrival_created",
        "nursing_triages",
        ["arrival_id", "created_at"],
    )


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return
    tables = set(inspect(op.get_bind()).get_table_names())
    if "nursing_triages" in tables:
        op.drop_table("nursing_triages")
