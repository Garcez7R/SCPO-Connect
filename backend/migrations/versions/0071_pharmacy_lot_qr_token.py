"""Add opaque QR identifiers to pharmacy inventory lots."""

import os
import uuid

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0071_pharmacy_lot_qr_token"
down_revision = "0070_user_active_module"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "pharmacy":
        return

    bind = op.get_bind()
    if not inspect(bind).has_table("inventory_items"):
        return
    columns = {column["name"] for column in inspect(bind).get_columns("inventory_items")}
    if "lot_qr_token" not in columns:
        op.add_column(
            "inventory_items",
            sa.Column("lot_qr_token", sa.String(length=36), nullable=True),
        )

    rows = bind.execute(
        sa.text("SELECT id FROM inventory_items WHERE lot_qr_token IS NULL")
    ).fetchall()
    for (lot_id,) in rows:
        bind.execute(
            sa.text("UPDATE inventory_items SET lot_qr_token = :token WHERE id = :id"),
            {"token": str(uuid.uuid4()), "id": lot_id},
        )

    indexes = {index["name"] for index in inspect(bind).get_indexes("inventory_items")}
    if "uq_inventory_items_lot_qr_token" not in indexes:
        op.execute(
            "CREATE UNIQUE INDEX uq_inventory_items_lot_qr_token ON inventory_items (lot_qr_token)"
        )


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "pharmacy":
        return

    bind = op.get_bind()
    if not inspect(bind).has_table("inventory_items"):
        return
    columns = {column["name"] for column in inspect(bind).get_columns("inventory_items")}
    if "lot_qr_token" not in columns:
        return
    indexes = {index["name"] for index in inspect(bind).get_indexes("inventory_items")}
    if "uq_inventory_items_lot_qr_token" in indexes:
        op.drop_index("uq_inventory_items_lot_qr_token", table_name="inventory_items")
    op.drop_column("inventory_items", "lot_qr_token")
