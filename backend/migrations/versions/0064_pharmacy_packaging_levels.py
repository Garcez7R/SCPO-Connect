"""Store verified multi-level packaging conversions."""

import json
import os

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect, text

revision = "0064_pharmacy_packaging"
down_revision = "0063_user_activity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "pharmacy":
        return

    bind = op.get_bind()
    tables = set(inspect(bind).get_table_names())
    if "pharmacy_products" not in tables:
        return

    for table in ("pharmacy_products", "inventory_items", "purchase_requests"):
        if table not in tables:
            continue
        columns = {column["name"] for column in inspect(bind).get_columns(table)}
        if table == "pharmacy_products" and "packaging_purchase_unit" not in columns:
            op.add_column(
                table,
                sa.Column(
                    "packaging_purchase_unit",
                    sa.String(length=24),
                    nullable=False,
                    server_default="",
                ),
            )
            columns.add("packaging_purchase_unit")
        if "packaging_levels" not in columns:
            op.add_column(
                table,
                sa.Column(
                    "packaging_levels",
                    sa.JSON(),
                    nullable=False,
                    server_default=sa.text("'[]'"),
                ),
            )

    if "inventory_items" in tables:
        inventory_items = sa.table(
            "inventory_items",
            sa.column("id", sa.Integer()),
            sa.column("packaging_levels", sa.JSON()),
        )
        for row in bind.execute(
            text(
                "SELECT i.id, i.purchase_unit, i.units_per_purchase_unit, p.unit "
                "FROM inventory_items i JOIN pharmacy_products p ON p.id=i.product_id "
                "ORDER BY i.id"
            )
        ).mappings():
            bind.execute(
                sa.update(inventory_items)
                .where(inventory_items.c.id == row["id"])
                .values(
                    packaging_levels=[
                        {
                            "unit": row["unit"],
                            "units_per_parent": row["units_per_purchase_unit"] or "1",
                        }
                    ]
                ),
            )

    if "purchase_requests" in tables:
        columns = {column["name"] for column in inspect(bind).get_columns("purchase_requests")}
        if {"id", "purchase_unit", "units_per_purchase_unit", "base_unit"} <= columns:
            purchase_requests = sa.table(
                "purchase_requests",
                sa.column("id", sa.String()),
                sa.column("packaging_levels", sa.JSON()),
            )
            for row in bind.execute(
                text(
                    "SELECT id, purchase_unit, units_per_purchase_unit, base_unit "
                    "FROM purchase_requests ORDER BY id"
                )
            ).mappings():
                bind.execute(
                    sa.update(purchase_requests)
                    .where(purchase_requests.c.id == row["id"])
                    .values(
                        packaging_levels=[
                            {
                                "unit": row["base_unit"],
                                "units_per_parent": row["units_per_purchase_unit"] or "1",
                            }
                        ]
                    ),
                )

    product_columns = {
        column["name"] for column in inspect(bind).get_columns("pharmacy_products")
    }
    if "packaging_levels" in product_columns and "inventory_items" in tables:
        pharmacy_products = sa.table(
            "pharmacy_products",
            sa.column("id", sa.Integer()),
            sa.column("packaging_levels", sa.JSON()),
            sa.column("packaging_purchase_unit", sa.String()),
        )
        products_with_packaging: set[int] = set()
        for row in bind.execute(
            text(
                "SELECT i.product_id, i.packaging_levels, i.purchase_unit "
                "FROM inventory_items i "
                "ORDER BY i.id"
            )
        ).mappings():
            product_id = int(row["product_id"])
            if product_id in products_with_packaging:
                continue
            levels = row["packaging_levels"]
            if isinstance(levels, str):
                levels = json.loads(levels)
            bind.execute(
                sa.update(pharmacy_products)
                .where(pharmacy_products.c.id == product_id)
                .values(
                    packaging_levels=levels,
                    packaging_purchase_unit=row["purchase_unit"] or "",
                ),
            )
            products_with_packaging.add(product_id)


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "pharmacy":
        return

    bind = op.get_bind()
    tables = set(inspect(bind).get_table_names())
    for table in ("purchase_requests", "inventory_items", "pharmacy_products"):
        if table in tables and "packaging_levels" in {
            column["name"] for column in inspect(bind).get_columns(table)
        }:
            op.drop_column(table, "packaging_levels")
        if table == "pharmacy_products" and table in tables and "packaging_purchase_unit" in {
            column["name"] for column in inspect(bind).get_columns(table)
        }:
            op.drop_column(table, "packaging_purchase_unit")
