"""Allow administrators to publish textual app announcements."""

import os

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0067_app_announcement_content"
down_revision = "0066_app_announcements"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "access":
        return

    bind = op.get_bind()
    if not inspect(bind).has_table("app_announcements"):
        return
    columns = {column["name"] for column in inspect(bind).get_columns("app_announcements")}
    if "url" in columns:
        with op.batch_alter_table("app_announcements") as batch_op:
            batch_op.alter_column("url", existing_type=sa.String(length=2048), nullable=True)
    if "content" not in columns:
        op.add_column("app_announcements", sa.Column("content", sa.String(length=5000), nullable=True))
    if "kind" not in columns:
        op.add_column(
            "app_announcements",
            sa.Column("kind", sa.String(length=32), nullable=False, server_default="notice"),
        )


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "access":
        return

    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("app_announcements")}
    if "kind" in columns:
        op.drop_column("app_announcements", "kind")
    if "content" in columns:
        op.drop_column("app_announcements", "content")
