"""Add idempotent receipts for offline Nursing submissions."""

import os

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0052_nursing_offline_actions"
down_revision = "0051_therapy_materials_library"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return

    bind = op.get_bind()
    existing = set(inspect(bind).get_table_names())
    if "nursing_offline_action_receipts" not in existing:
        op.create_table(
            "nursing_offline_action_receipts",
            sa.Column("action_id", sa.String(length=36), primary_key=True),
            sa.Column("actor_id", sa.String(length=36), nullable=False),
            sa.Column("action_type", sa.String(length=32), nullable=False),
            sa.Column("payload_hash", sa.String(length=64), nullable=False),
            sa.Column("resource_id", sa.String(length=80), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index(
            "ix_nursing_offline_action_receipts_actor_id",
            "nursing_offline_action_receipts",
            ["actor_id"],
        )


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return

    bind = op.get_bind()
    if "nursing_offline_action_receipts" in set(inspect(bind).get_table_names()):
        op.drop_index(
            "ix_nursing_offline_action_receipts_actor_id",
            table_name="nursing_offline_action_receipts",
        )
        op.drop_table("nursing_offline_action_receipts")
