"""Create a dedicated queue for hygiene requests."""

import os

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0021_hygiene_requests"
down_revision = "0020_psychology_encounters"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "maintenance":
        return
    if "hygiene_requests" in inspect(op.get_bind()).get_table_names():
        return

    op.create_table(
        "hygiene_requests",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("request_type", sa.String(32), nullable=False),
        sa.Column("custom_type", sa.String(80), nullable=True),
        sa.Column("unit", sa.String(80), nullable=False),
        sa.Column("area", sa.String(32), nullable=False),
        sa.Column("location", sa.String(120), nullable=False),
        sa.Column("description", sa.String(1000), nullable=False, server_default=""),
        sa.Column("priority", sa.String(12), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("assignee", sa.String(120), nullable=False, server_default=""),
        sa.Column("requester_id", sa.String(36), nullable=False),
        sa.Column("requester_name", sa.String(120), nullable=False),
        sa.Column("updated_by", sa.String(120), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_hygiene_requests_status_priority_created",
        "hygiene_requests",
        ["status", "priority", "created_at"],
    )
    op.create_index(
        "ix_hygiene_requests_requester_created",
        "hygiene_requests",
        ["requester_id", "created_at"],
    )


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "maintenance":
        return
    if "hygiene_requests" not in inspect(op.get_bind()).get_table_names():
        return
    op.drop_index(
        "ix_hygiene_requests_requester_created",
        table_name="hygiene_requests",
    )
    op.drop_index(
        "ix_hygiene_requests_status_priority_created",
        table_name="hygiene_requests",
    )
    op.drop_table("hygiene_requests")
