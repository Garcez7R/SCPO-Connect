"""Create a separate, auditable psychology referral queue."""

import os

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect


revision = "0018_psychology_referrals"
down_revision = "0017_pharmacy_average_balance"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "social":
        return
    if "psychology_referrals" not in inspect(op.get_bind()).get_table_names():
        op.create_table(
            "psychology_referrals",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("patient_reference", sa.String(36), nullable=False),
            sa.Column("referral_type", sa.String(80), nullable=False),
            sa.Column("status", sa.String(16), nullable=False, server_default="open"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index(
            "ix_psychology_referrals_patient_reference",
            "psychology_referrals",
            ["patient_reference"],
        )


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "social":
        return
    if "psychology_referrals" in inspect(op.get_bind()).get_table_names():
        op.drop_index(
            "ix_psychology_referrals_patient_reference",
            table_name="psychology_referrals",
        )
        op.drop_table("psychology_referrals")
