"""Track the module for recent authenticated user activity."""

import os

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0070_user_active_module"
down_revision = "0069_warehouse_global_module"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "access":
        return

    bind = op.get_bind()
    if not inspect(bind).has_table("system_user_activity"):
        return
    columns = {column["name"] for column in inspect(bind).get_columns("system_user_activity")}
    if "active_module" not in columns:
        op.add_column(
            "system_user_activity",
            sa.Column("active_module", sa.String(length=40), nullable=True),
        )


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "access":
        return

    bind = op.get_bind()
    if not inspect(bind).has_table("system_user_activity"):
        return
    columns = {column["name"] for column in inspect(bind).get_columns("system_user_activity")}
    if "active_module" in columns:
        op.drop_column("system_user_activity", "active_module")
