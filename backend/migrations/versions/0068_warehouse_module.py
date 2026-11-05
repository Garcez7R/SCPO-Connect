"""Create the warehouse catalog, movements and sector requests."""

import os

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0068_warehouse_module"
down_revision = "0067_app_announcement_content"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "maintenance":
        return

    bind = op.get_bind()
    inspector = inspect(bind)

    if not inspector.has_table("warehouse_items"):
        op.create_table(
            "warehouse_items",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("name", sa.String(length=120), nullable=False),
            sa.Column("category", sa.String(length=80), nullable=False),
            sa.Column("unit", sa.String(length=24), nullable=False),
            sa.Column("location", sa.String(length=120), nullable=False),
            sa.Column("barcode", sa.String(length=80), nullable=False),
            sa.Column("lot", sa.String(length=80), nullable=False),
            sa.Column("expiry_date", sa.Date(), nullable=True),
            sa.Column("serial_number", sa.String(length=100), nullable=False),
            sa.Column("balance", sa.Numeric(12, 3), nullable=False),
            sa.Column("minimum_balance", sa.Numeric(12, 3), nullable=False),
            sa.Column("active", sa.Boolean(), nullable=False),
            sa.Column("created_by", sa.String(length=120), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )

    if not inspector.has_table("warehouse_movements"):
        op.create_table(
            "warehouse_movements",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("item_id", sa.String(length=36), nullable=False),
            sa.Column("movement_type", sa.String(length=16), nullable=False),
            sa.Column("quantity", sa.Numeric(12, 3), nullable=False),
            sa.Column("balance_after", sa.Numeric(12, 3), nullable=False),
            sa.Column("reason", sa.String(length=500), nullable=False),
            sa.Column("destination", sa.String(length=120), nullable=False),
            sa.Column("work_order_id", sa.String(length=36), nullable=True),
            sa.Column("actor_id", sa.String(length=36), nullable=False),
            sa.Column("actor_name", sa.String(length=120), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["item_id"], ["warehouse_items.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_warehouse_movements_item_id", "warehouse_movements", ["item_id"])
        op.create_index("ix_warehouse_movements_work_order_id", "warehouse_movements", ["work_order_id"])
        op.create_index("ix_warehouse_movements_item_created", "warehouse_movements", ["item_id", "created_at"])

    if not inspector.has_table("warehouse_requests"):
        op.create_table(
            "warehouse_requests",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("item_id", sa.String(length=36), nullable=False),
            sa.Column("quantity", sa.Numeric(12, 3), nullable=False),
            sa.Column("department", sa.String(length=120), nullable=False),
            sa.Column("destination", sa.String(length=120), nullable=False),
            sa.Column("justification", sa.String(length=500), nullable=False),
            sa.Column("work_order_id", sa.String(length=36), nullable=True),
            sa.Column("status", sa.String(length=16), nullable=False),
            sa.Column("requester_id", sa.String(length=36), nullable=False),
            sa.Column("requester_name", sa.String(length=120), nullable=False),
            sa.Column("updated_by", sa.String(length=120), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["item_id"], ["warehouse_items.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_warehouse_requests_item_id", "warehouse_requests", ["item_id"])
        op.create_index("ix_warehouse_requests_work_order_id", "warehouse_requests", ["work_order_id"])


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "maintenance":
        return
    inspector = inspect(op.get_bind())
    if inspector.has_table("warehouse_requests"):
        op.drop_table("warehouse_requests")
    if inspector.has_table("warehouse_movements"):
        op.drop_table("warehouse_movements")
    if inspector.has_table("warehouse_items"):
        op.drop_table("warehouse_items")
