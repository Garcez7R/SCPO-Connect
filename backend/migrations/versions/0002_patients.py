"""Add fictitious patient registry to the nursing service."""

import os

import sqlalchemy as sa
from alembic import op

revision = "0002_patients"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") == "nursing":
        op.create_table(
            "patients",
            sa.Column("reference", sa.String(32), primary_key=True),
            sa.Column("name", sa.String(120), nullable=False),
            sa.Column("room", sa.String(20), nullable=False),
            sa.Column("bed", sa.String(20), nullable=False),
            sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        )


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") == "nursing":
        op.drop_table("patients")
