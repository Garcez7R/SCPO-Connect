"""Store therapy sessions beside the shared patient registry."""

import os

import sqlalchemy as sa
from alembic import op


revision = "0008_therapy_calendar"
down_revision = "0007_patient_therapy"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return
    op.create_table(
        "therapy_activities",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("title", sa.String(120), nullable=False),
        sa.Column("activity_type", sa.String(40), nullable=False),
        sa.Column("description", sa.String(1000), nullable=False, server_default=""),
        sa.Column("location", sa.String(120), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("patient_reference", sa.String(36), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="scheduled"),
        sa.Column("created_by", sa.String(120), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_therapy_activities_starts_at", "therapy_activities", ["starts_at"])


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return
    op.drop_index("ix_therapy_activities_starts_at", table_name="therapy_activities")
    op.drop_table("therapy_activities")
