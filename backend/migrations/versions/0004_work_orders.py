"""Create work orders and status history for the maintenance workflow."""

import os

import sqlalchemy as sa
from alembic import op


revision = "0004_work_orders"
down_revision = "0003_local_auth"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "maintenance":
        return
    op.create_table(
        "work_orders",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("title", sa.String(120), nullable=False),
        sa.Column("description", sa.String(1500), nullable=False),
        sa.Column("department", sa.String(100), nullable=False),
        sa.Column("location", sa.String(120), nullable=False, server_default=""),
        sa.Column("priority", sa.String(12), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("requester_id", sa.String(36), nullable=False),
        sa.Column("requester_name", sa.String(120), nullable=False),
        sa.Column("updated_by", sa.String(120), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "work_order_events",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("order_id", sa.String(36), sa.ForeignKey("work_orders.id", ondelete="CASCADE"), nullable=False),
        sa.Column("actor_id", sa.String(36), nullable=False),
        sa.Column("actor_name", sa.String(120), nullable=False),
        sa.Column("action", sa.String(24), nullable=False),
        sa.Column("old_status", sa.String(16), nullable=True),
        sa.Column("new_status", sa.String(16), nullable=False),
        sa.Column("note", sa.String(500), nullable=False, server_default=""),
        sa.Column("happened_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_work_order_events_order_id", "work_order_events", ["order_id"])


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "maintenance":
        return
    op.drop_index("ix_work_order_events_order_id", table_name="work_order_events")
    op.drop_table("work_order_events")
    op.drop_table("work_orders")
