"""Move pharmacy stock targets from lots to their product."""

import os
from decimal import Decimal, InvalidOperation

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect, text

revision = "0057_product_stock_levels"
down_revision = "0056_audit_retention_checkpoint"
branch_labels = None
depends_on = None


def _quantity_text(value: Decimal) -> str:
    normalized = format(value, "f")
    if "." in normalized:
        normalized = normalized.rstrip("0").rstrip(".")
    return normalized or "0"


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "pharmacy":
        return

    bind = op.get_bind()
    if "pharmacy_products" not in inspect(bind).get_table_names():
        return

    columns = {
        column["name"] for column in inspect(bind).get_columns("pharmacy_products")
    }
    if "minimum_balance" not in columns:
        op.add_column(
            "pharmacy_products",
            sa.Column(
                "minimum_balance",
                sa.String(length=32),
                nullable=False,
                server_default="0",
            ),
        )
    if "average_balance" not in columns:
        op.add_column(
            "pharmacy_products",
            sa.Column(
                "average_balance",
                sa.String(length=32),
                nullable=False,
                server_default="0",
            ),
        )

    if "inventory_items" not in inspect(bind).get_table_names():
        return
    thresholds: dict[int, tuple[Decimal, Decimal]] = {}
    rows = bind.execute(
        text(
            "SELECT product_id, minimum_balance, average_balance "
            "FROM inventory_items ORDER BY id"
        )
    ).mappings()
    for row in rows:
        try:
            minimum = Decimal(str(row["minimum_balance"] or "0").replace(",", "."))
            average = Decimal(str(row["average_balance"] or "0").replace(",", "."))
        except InvalidOperation as exc:
            raise ValueError(
                "Farmácia possui metas de estoque inválidas; migração cancelada"
            ) from exc
        product_id = int(row["product_id"])
        previous = thresholds.get(product_id, (Decimal(0), Decimal(0)))
        thresholds[product_id] = (max(previous[0], minimum), max(previous[1], average))

    for product_id, (minimum, average) in thresholds.items():
        bind.execute(
            text(
                "UPDATE pharmacy_products "
                "SET minimum_balance=:minimum, average_balance=:average "
                "WHERE id=:product_id"
            ),
            {
                "product_id": product_id,
                "minimum": _quantity_text(minimum),
                "average": _quantity_text(average),
            },
        )


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "pharmacy":
        return

    bind = op.get_bind()
    if "pharmacy_products" not in inspect(bind).get_table_names():
        return
    columns = {
        column["name"] for column in inspect(bind).get_columns("pharmacy_products")
    }
    for name in ("average_balance", "minimum_balance"):
        if name in columns:
            op.drop_column("pharmacy_products", name)
