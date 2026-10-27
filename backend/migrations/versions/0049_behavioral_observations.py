"""Add objective, auditable behavioral observations for patient history."""

import os

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0049_behavioral_observations"
down_revision = "0048_reception_announcement"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return

    bind = op.get_bind()
    if "behavioral_observations" not in inspect(bind).get_table_names():
        op.create_table(
            "behavioral_observations",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "patient_reference",
                sa.String(36),
                sa.ForeignKey("patients.reference", ondelete="RESTRICT"),
                nullable=False,
            ),
            sa.Column("observation", sa.String(2000), nullable=False),
            sa.Column("context", sa.String(500), nullable=False, server_default=""),
            sa.Column("response", sa.String(1000), nullable=False, server_default=""),
            sa.Column("status", sa.String(8), nullable=True),
            sa.Column("actor_id", sa.String(36), nullable=False),
            sa.Column("actor_name", sa.String(120), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index(
            "ix_behavioral_observations_patient_created",
            "behavioral_observations",
            ["patient_reference", "created_at"],
        )


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return

    if "behavioral_observations" in inspect(op.get_bind()).get_table_names():
        op.drop_index(
            "ix_behavioral_observations_patient_created",
            table_name="behavioral_observations",
        )
        op.drop_table("behavioral_observations")
