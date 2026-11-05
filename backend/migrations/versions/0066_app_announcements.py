"""Add authenticated application announcements."""

import os

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0066_app_announcements"
down_revision = "0065_anvisa_auto_state"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "access":
        return

    bind = op.get_bind()
    if inspect(bind).has_table("app_announcements"):
        return

    op.create_table(
        "app_announcements",
        sa.Column("id", sa.String(length=36), primary_key=True, nullable=False),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("url", sa.String(length=2048), nullable=False),
        sa.Column("summary", sa.String(length=500), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_id", sa.String(length=36), nullable=False),
        sa.Column("created_by_name", sa.String(length=120), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_app_announcements_published_active",
        "app_announcements",
        ["published_at", "active"],
        unique=False,
    )


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "access":
        return
    bind = op.get_bind()
    if inspect(bind).has_table("app_announcements"):
        op.drop_index("ix_app_announcements_published_active", table_name="app_announcements")
        op.drop_table("app_announcements")
