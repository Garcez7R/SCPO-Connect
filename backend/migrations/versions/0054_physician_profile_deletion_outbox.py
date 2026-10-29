"""Queue physician profile cleanup with account deletion requests."""

import os

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0054_physician_profile_deletion_outbox"
down_revision = "0053_user_display_name"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "access":
        return

    bind = op.get_bind()
    if "physician_profile_deletion_outbox" in set(inspect(bind).get_table_names()):
        return

    op.create_table(
        "physician_profile_deletion_outbox",
        sa.Column("user_id", sa.String(length=36), primary_key=True),
        sa.Column("actor_id", sa.String(length=36), nullable=False),
        sa.Column("actor_name", sa.String(length=100), nullable=False),
        sa.Column("actor_role", sa.String(length=40), nullable=False),
        sa.Column("requested_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error", sa.String(length=500), nullable=False, server_default=""),
    )
    op.create_index(
        "ix_physician_profile_deletion_outbox_next_attempt",
        "physician_profile_deletion_outbox",
        ["next_attempt_at"],
    )


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "access":
        return

    bind = op.get_bind()
    if "physician_profile_deletion_outbox" not in set(inspect(bind).get_table_names()):
        return
    op.drop_index(
        "ix_physician_profile_deletion_outbox_next_attempt",
        table_name="physician_profile_deletion_outbox",
    )
    op.drop_table("physician_profile_deletion_outbox")