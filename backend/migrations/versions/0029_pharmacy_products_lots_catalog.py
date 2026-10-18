"""Normalize pharmacy products, stock lots, locations, and Anvisa catalog cache."""

import os
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect, text

revision = "0029_pharmacy_products"
down_revision = "0028_durable_audit"
branch_labels = None
depends_on = None


def _normalized_gtin(value: str) -> str | None:
    code = value.strip()
    for prefix in ("]d2", "]C1", "]Q3"):
        if code.startswith(prefix):
            code = code[len(prefix):]
            break
    if code.startswith("(01)"):
        code = code[4:18]
    elif code.startswith("01") and len(code) >= 16:
        code = code[2:16]
    if len(code) not in {8, 12, 13, 14} or not code.isdigit():
        return None
    body = code[:-1]
    weighted_sum = sum(
        int(digit) * (3 if position % 2 == 0 else 1)
        for position, digit in enumerate(reversed(body))
    )
    if (10 - weighted_sum % 10) % 10 != int(code[-1]):
        return None
    return code.zfill(14)


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "pharmacy":
        return

    bind = op.get_bind()
    tables = set(inspect(bind).get_table_names())
    if "pharmacy_products" not in tables:
        op.create_table(
            "pharmacy_products",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("gtin", sa.String(14), nullable=True),
            sa.Column("legacy_identifier", sa.String(40), nullable=False, server_default=""),
            sa.Column("name", sa.String(120), nullable=False),
            sa.Column("category", sa.String(40), nullable=False),
            sa.Column("active_ingredient", sa.String(120), nullable=False, server_default=""),
            sa.Column("presentation", sa.String(120), nullable=False, server_default=""),
            sa.Column("unit", sa.String(24), nullable=False),
            sa.Column("metadata_source", sa.String(16), nullable=False, server_default="legacy"),
            sa.Column("source_reference", sa.String(32), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index("ix_pharmacy_products_gtin", "pharmacy_products", ["gtin"])

    if "pharmacy_locations" not in tables:
        op.create_table(
            "pharmacy_locations",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("name", sa.String(80), nullable=False, unique=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )

    if "anvisa_catalog_entries" not in tables:
        op.create_table(
            "anvisa_catalog_entries",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("gtin", sa.String(14), nullable=False),
            sa.Column("product_name", sa.String(120), nullable=False),
            sa.Column("active_ingredient", sa.String(120), nullable=False, server_default=""),
            sa.Column("presentation", sa.String(120), nullable=False, server_default=""),
            sa.Column("manufacturer", sa.String(120), nullable=False, server_default=""),
            sa.Column("registration", sa.String(32), nullable=False, server_default=""),
            sa.Column("record_key", sa.String(64), nullable=False, unique=True),
            sa.Column("imported_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("source_updated_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_anvisa_catalog_entries_gtin", "anvisa_catalog_entries", ["gtin"])

    columns = {column["name"] for column in inspect(bind).get_columns("inventory_items")}
    if "product_id" not in columns:
        if bind.dialect.name == "sqlite":
            op.execute(
                "ALTER TABLE inventory_items ADD COLUMN product_id INTEGER "
                "REFERENCES pharmacy_products(id) ON DELETE RESTRICT"
            )
        else:
            op.add_column(
                "inventory_items",
                sa.Column(
                    "product_id",
                    sa.Integer(),
                    sa.ForeignKey("pharmacy_products.id", ondelete="RESTRICT"),
                    nullable=True,
                ),
            )
    if "location_id" not in columns:
        if bind.dialect.name == "sqlite":
            op.execute(
                "ALTER TABLE inventory_items ADD COLUMN location_id INTEGER "
                "REFERENCES pharmacy_locations(id) ON DELETE SET NULL"
            )
        else:
            op.add_column(
                "inventory_items",
                sa.Column(
                    "location_id",
                    sa.Integer(),
                    sa.ForeignKey("pharmacy_locations.id", ondelete="SET NULL"),
                    nullable=True,
                ),
            )

    rows = bind.execute(
        text(
            "SELECT id, item_name, barcode, category, active_ingredient, presentation, "
            "unit, storage_location, created_at FROM inventory_items ORDER BY id"
        )
    ).mappings().all()
    product_ids: dict[tuple[str | None, str, str, str, str, str, str], int] = {}
    location_ids: dict[str, int] = {}
    next_product_id = bind.execute(text("SELECT COALESCE(MAX(id), 0) + 1 FROM pharmacy_products")).scalar_one()
    next_location_id = bind.execute(text("SELECT COALESCE(MAX(id), 0) + 1 FROM pharmacy_locations")).scalar_one()

    for row in rows:
        gtin = _normalized_gtin(row["barcode"] or "")
        legacy_identifier = "" if gtin else (row["barcode"] or "")[:40]
        name = row["item_name"].strip()
        category = row["category"] or "Medicamento"
        active_ingredient = row["active_ingredient"] or ""
        presentation = row["presentation"] or ""
        unit = row["unit"]
        product_key = (
            gtin,
            legacy_identifier if gtin is None else "",
            name.casefold(),
            category.casefold(),
            active_ingredient.casefold(),
            presentation.casefold(),
            unit.casefold(),
        )
        product_id = product_ids.get(product_key)
        if product_id is None:
            product_id = next_product_id
            next_product_id += 1
            product_ids[product_key] = product_id
            bind.execute(
                text(
                    "INSERT INTO pharmacy_products "
                    "(id, gtin, legacy_identifier, name, category, active_ingredient, "
                    "presentation, unit, metadata_source, source_reference, created_at) "
                    "VALUES (:id, :gtin, :legacy_identifier, :name, :category, "
                    ":active_ingredient, :presentation, :unit, 'legacy', '', :created_at)"
                ),
                {
                    "id": product_id,
                    "gtin": gtin,
                    "legacy_identifier": legacy_identifier,
                    "name": name,
                    "category": category,
                    "active_ingredient": active_ingredient,
                    "presentation": presentation,
                    "unit": unit,
                    "created_at": row["created_at"] or datetime.now(UTC),
                },
            )

        location_name = (row["storage_location"] or "").strip()
        location_id = None
        if location_name:
            location_id = location_ids.get(location_name)
            if location_id is None:
                location_id = next_location_id
                next_location_id += 1
                location_ids[location_name] = location_id
                bind.execute(
                    text(
                        "INSERT INTO pharmacy_locations (id, name, created_at) "
                        "VALUES (:id, :name, :created_at)"
                    ),
                    {"id": location_id, "name": location_name, "created_at": datetime.now(UTC)},
                )
        bind.execute(
            text("UPDATE inventory_items SET product_id=:product_id, location_id=:location_id WHERE id=:id"),
            {"product_id": product_id, "location_id": location_id, "id": row["id"]},
        )

    op.create_index("ix_inventory_items_product_id", "inventory_items", ["product_id"])
    op.create_index("ix_inventory_items_location_id", "inventory_items", ["location_id"])
    for column in (
        "item_name",
        "barcode",
        "category",
        "active_ingredient",
        "presentation",
        "unit",
        "storage_location",
    ):
        op.drop_column("inventory_items", column)


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "pharmacy":
        return

    bind = op.get_bind()
    tables = set(inspect(bind).get_table_names())
    if "inventory_items" in tables:
        columns = {column["name"] for column in inspect(bind).get_columns("inventory_items")}
        additions = (
            ("item_name", sa.String(120), ""),
            ("barcode", sa.String(40), ""),
            ("category", sa.String(40), "Medicamento"),
            ("active_ingredient", sa.String(120), ""),
            ("presentation", sa.String(120), ""),
            ("unit", sa.String(24), "unidade"),
            ("storage_location", sa.String(80), ""),
        )
        for name, column_type, default in additions:
            if name not in columns:
                op.add_column(
                    "inventory_items",
                    sa.Column(name, column_type, nullable=False, server_default=default),
                )
        rows = bind.execute(
            text(
                "SELECT i.id, p.name, p.gtin, p.legacy_identifier, p.category, "
                "p.active_ingredient, p.presentation, p.unit, l.name AS location_name "
                "FROM inventory_items i JOIN pharmacy_products p ON p.id=i.product_id "
                "LEFT JOIN pharmacy_locations l ON l.id=i.location_id"
            )
        ).mappings().all()
        for row in rows:
            bind.execute(
                text(
                    "UPDATE inventory_items SET item_name=:item_name, barcode=:barcode, "
                    "category=:category, active_ingredient=:active_ingredient, "
                    "presentation=:presentation, unit=:unit, storage_location=:storage_location "
                    "WHERE id=:id"
                ),
                {
                    "id": row["id"],
                    "item_name": row["name"],
                    "barcode": row["gtin"] or row["legacy_identifier"],
                    "category": row["category"],
                    "active_ingredient": row["active_ingredient"],
                    "presentation": row["presentation"],
                    "unit": row["unit"],
                    "storage_location": row["location_name"] or "",
                },
            )
        op.drop_index("ix_inventory_items_location_id", table_name="inventory_items")
        op.drop_index("ix_inventory_items_product_id", table_name="inventory_items")
        op.drop_column("inventory_items", "location_id")
        op.drop_column("inventory_items", "product_id")

    if "anvisa_catalog_entries" in tables:
        op.drop_index("ix_anvisa_catalog_entries_gtin", table_name="anvisa_catalog_entries")
        op.drop_table("anvisa_catalog_entries")
    if "pharmacy_locations" in tables:
        op.drop_table("pharmacy_locations")
    if "pharmacy_products" in tables:
        op.drop_index("ix_pharmacy_products_gtin", table_name="pharmacy_products")
        op.drop_table("pharmacy_products")
