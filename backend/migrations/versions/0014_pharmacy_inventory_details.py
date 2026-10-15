"""Add product identifiers and stock control metadata to pharmacy batches."""

import os

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect


revision = "0014_pharmacy_inventory_details"
down_revision = "0013_maintenance_service_type"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "pharmacy":
        return
    columns = {column["name"] for column in inspect(op.get_bind()).get_columns("inventory_items")}
    additions = (
        sa.Column("barcode", sa.String(40), nullable=False, server_default=""),
        sa.Column("category", sa.String(40), nullable=False, server_default="Medicamento"),
        sa.Column("presentation", sa.String(120), nullable=False, server_default=""),
        sa.Column("supplier", sa.String(120), nullable=False, server_default=""),
        sa.Column("storage_location", sa.String(80), nullable=False, server_default=""),
        sa.Column("minimum_balance", sa.String(32), nullable=False, server_default="0"),
    )
    for column in additions:
        if column.name not in columns:
            op.add_column("inventory_items", column)


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "pharmacy":
        return
    columns = {column["name"] for column in inspect(op.get_bind()).get_columns("inventory_items")}
    for column in ("minimum_balance", "storage_location", "supplier", "presentation", "category", "barcode"):
        if column in columns:
            op.drop_column("inventory_items", column)
