"""Add persistent hourly nursing rounds."""

import os

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0042_nursing_hourly_rounds"
down_revision = "0041_medical_orders_lab_exams"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return

    tables = set(inspect(op.get_bind()).get_table_names())
    if "nursing_hourly_rounds" not in tables:
        op.create_table(
            "nursing_hourly_rounds",
            sa.Column("id", sa.String(length=36), primary_key=True),
            sa.Column("status", sa.String(length=16), nullable=False, server_default="open"),
            sa.Column("started_by_id", sa.String(length=36), nullable=False),
            sa.Column("started_by_name", sa.String(length=120), nullable=False),
            sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("completed_by_id", sa.String(length=36), nullable=True),
            sa.Column("completed_by_name", sa.String(length=120), nullable=False, server_default=""),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index(
            "uq_nursing_hourly_rounds_open",
            "nursing_hourly_rounds",
            ["status"],
            unique=True,
            sqlite_where=sa.text("status = 'open'"),
            postgresql_where=sa.text("status = 'open'"),
        )
        op.create_index(
            "ix_nursing_hourly_rounds_started_at",
            "nursing_hourly_rounds",
            ["started_at"],
        )

    if "nursing_hourly_round_patients" not in tables:
        op.create_table(
            "nursing_hourly_round_patients",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "round_id",
                sa.String(length=36),
                sa.ForeignKey("nursing_hourly_rounds.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("patient_reference", sa.String(length=36), nullable=False),
            sa.Column("patient_name", sa.String(length=120), nullable=False),
            sa.Column("room", sa.String(length=20), nullable=False),
            sa.Column("bed", sa.String(length=20), nullable=False),
            sa.Column("status", sa.String(length=16), nullable=False, server_default="pending"),
            sa.Column("exception_type", sa.String(length=24), nullable=False, server_default=""),
            sa.Column("note", sa.String(length=500), nullable=False, server_default=""),
            sa.Column("checked_by_id", sa.String(length=36), nullable=False, server_default=""),
            sa.Column("checked_by_name", sa.String(length=120), nullable=False, server_default=""),
            sa.Column("checked_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index(
            "uq_nursing_hourly_round_patients_reference",
            "nursing_hourly_round_patients",
            ["round_id", "patient_reference"],
            unique=True,
        )
        op.create_index(
            "ix_nursing_hourly_round_patients_round_status",
            "nursing_hourly_round_patients",
            ["round_id", "status"],
        )


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return

    tables = set(inspect(op.get_bind()).get_table_names())
    if "nursing_hourly_round_patients" in tables:
        op.drop_index(
            "ix_nursing_hourly_round_patients_round_status",
            table_name="nursing_hourly_round_patients",
        )
        op.drop_index(
            "uq_nursing_hourly_round_patients_reference",
            table_name="nursing_hourly_round_patients",
        )
        op.drop_table("nursing_hourly_round_patients")
    if "nursing_hourly_rounds" in tables:
        op.drop_index(
            "ix_nursing_hourly_rounds_started_at",
            table_name="nursing_hourly_rounds",
        )
        op.drop_index(
            "uq_nursing_hourly_rounds_open",
            table_name="nursing_hourly_rounds",
        )
        op.drop_table("nursing_hourly_rounds")
