"""Add laundry catalog, request workflow, and inventory movements."""

import os

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0058_laundry_inventory"
down_revision = "0057_product_stock_levels"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "maintenance":
        return

    bind = op.get_bind()
    existing = set(inspect(bind).get_table_names())
    if "laundry_catalog_items" not in existing:
        op.create_table(
            "laundry_catalog_items",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("name", sa.String(120), nullable=False, unique=True),
            sa.Column("category", sa.String(80), nullable=False),
            sa.Column("unit", sa.String(20), nullable=False),
            sa.Column("created_by", sa.String(120), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        )
    if "laundry_requests" not in existing:
        op.create_table(
            "laundry_requests",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "request_number",
                sa.Integer(),
                sa.ForeignKey("service_request_numbers.id"),
                nullable=False,
                unique=True,
            ),
            sa.Column("unit", sa.String(80), nullable=False),
            sa.Column("area", sa.String(120), nullable=False),
            sa.Column("description", sa.String(500), nullable=False, server_default=""),
            sa.Column("priority", sa.String(12), nullable=False),
            sa.Column("status", sa.String(16), nullable=False),
            sa.Column("assignee", sa.String(120), nullable=False, server_default=""),
            sa.Column("requester_id", sa.String(36), nullable=False),
            sa.Column("requester_name", sa.String(120), nullable=False),
            sa.Column("updated_by", sa.String(120), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        )
    if "laundry_request_items" not in existing:
        op.create_table(
            "laundry_request_items",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "request_id",
                sa.String(36),
                sa.ForeignKey("laundry_requests.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "item_id",
                sa.String(36),
                sa.ForeignKey("laundry_catalog_items.id", ondelete="RESTRICT"),
                nullable=False,
            ),
            sa.Column("quantity", sa.Numeric(12, 3), nullable=False),
            sa.UniqueConstraint("request_id", "item_id", name="uq_laundry_request_item"),
        )
        op.create_index(
            "ix_laundry_request_items_request_id",
            "laundry_request_items",
            ["request_id"],
        )
        op.create_index(
            "ix_laundry_request_items_item_id", "laundry_request_items", ["item_id"]
        )
    if "laundry_inventory_movements" not in existing:
        op.create_table(
            "laundry_inventory_movements",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column(
                "item_id",
                sa.String(36),
                sa.ForeignKey("laundry_catalog_items.id", ondelete="RESTRICT"),
                nullable=False,
            ),
            sa.Column(
                "request_id",
                sa.String(36),
                sa.ForeignKey("laundry_requests.id", ondelete="RESTRICT"),
                nullable=False,
            ),
            sa.Column("unit", sa.String(80), nullable=False),
            sa.Column("movement_type", sa.String(24), nullable=False),
            sa.Column("quantity", sa.Numeric(12, 3), nullable=False),
            sa.Column("actor_id", sa.String(36), nullable=False),
            sa.Column("actor_name", sa.String(120), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index(
            "ix_laundry_inventory_movements_item_id",
            "laundry_inventory_movements",
            ["item_id"],
        )
        op.create_index(
            "ix_laundry_inventory_movements_request_id",
            "laundry_inventory_movements",
            ["request_id"],
        )
        op.create_index(
            "ix_laundry_inventory_item_created",
            "laundry_inventory_movements",
            ["item_id", "created_at"],
        )


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "maintenance":
        return

    bind = op.get_bind()
    existing = set(inspect(bind).get_table_names())
    if "laundry_inventory_movements" in existing:
        op.drop_index(
            "ix_laundry_inventory_item_created",
            table_name="laundry_inventory_movements",
        )
        op.drop_index(
            "ix_laundry_inventory_movements_request_id",
            table_name="laundry_inventory_movements",
        )
        op.drop_index(
            "ix_laundry_inventory_movements_item_id",
            table_name="laundry_inventory_movements",
        )
        op.drop_table("laundry_inventory_movements")
    if "laundry_request_items" in existing:
        op.drop_index(
            "ix_laundry_request_items_item_id", table_name="laundry_request_items"
        )
        op.drop_index(
            "ix_laundry_request_items_request_id",
            table_name="laundry_request_items",
        )
        op.drop_table("laundry_request_items")
    if "laundry_requests" in existing:
        op.drop_table("laundry_requests")
    if "laundry_catalog_items" in existing:
        op.drop_table("laundry_catalog_items")
