"""Track recent authenticated user activity for the system dashboard."""

import os

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0063_user_activity"
down_revision = "0062_therapy_album"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "access":
        return

    if "system_user_activity" not in inspect(op.get_bind()).get_table_names():
        op.create_table(
            "system_user_activity",
            sa.Column("user_id", sa.String(length=36), primary_key=True),
            sa.Column("last_activity_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["user_id"],
                ["app_users.id"],
                name="fk_system_user_activity_user_id",
                ondelete="CASCADE",
            ),
        )
        op.create_index(
            "ix_system_user_activity_last_activity_at",
            "system_user_activity",
            ["last_activity_at"],
        )


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "access":
        return

    if "system_user_activity" in inspect(op.get_bind()).get_table_names():
        op.drop_index(
            "ix_system_user_activity_last_activity_at",
            table_name="system_user_activity",
        )
        op.drop_table("system_user_activity")
