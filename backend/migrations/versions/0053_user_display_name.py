"""Add a user-controlled work-area display name."""

import os

import sqlalchemy as sa
from alembic import op

revision = "0053_user_display_name"
down_revision = "0052_nursing_offline_actions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") == "access":
        op.add_column("app_users", sa.Column("display_name", sa.String(length=80), nullable=True))


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") == "access":
        op.drop_column("app_users", "display_name")
