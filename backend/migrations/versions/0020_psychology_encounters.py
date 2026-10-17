"""Add psychology triage fields and confidential encounter notes."""

import os

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0020_psychology_encounters"
down_revision = "0019_psychology_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "social":
        return

    inspector = inspect(op.get_bind())
    if "priority" not in {column["name"] for column in inspector.get_columns("psychology_referrals")}:
        op.add_column(
            "psychology_referrals",
            sa.Column("priority", sa.String(16), nullable=False, server_default="routine"),
        )

    if "psychology_encounters" not in inspector.get_table_names():
        op.create_table(
            "psychology_encounters",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("patient_reference", sa.String(36), nullable=False),
            sa.Column("encounter_type", sa.String(24), nullable=False),
            sa.Column("objective", sa.String(500), nullable=False),
            sa.Column("evolution", sa.Text(), nullable=False),
            sa.Column("plan", sa.Text(), nullable=False),
            sa.Column("actor_id", sa.String(36), nullable=False),
            sa.Column("actor_name", sa.String(120), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index(
            "ix_psychology_encounters_patient_date",
            "psychology_encounters",
            ["patient_reference", "created_at"],
        )


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "social":
        return

    inspector = inspect(op.get_bind())
    if "psychology_encounters" in inspector.get_table_names():
        op.drop_index(
            "ix_psychology_encounters_patient_date",
            table_name="psychology_encounters",
        )
        op.drop_table("psychology_encounters")
    columns = {column["name"] for column in inspect(op.get_bind()).get_columns("psychology_referrals")}
    if "priority" in columns:
        op.drop_column("psychology_referrals", "priority")
