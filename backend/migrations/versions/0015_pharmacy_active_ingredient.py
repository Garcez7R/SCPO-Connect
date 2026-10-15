"""Add active ingredient field to pharmacy inventory items."""

import os

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect


revision = "0015_pharmacy_active_ingredient"
down_revision = "0014_pharmacy_inventory_details"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "pharmacy":
        return
    columns = {column["name"] for column in inspect(op.get_bind()).get_columns("inventory_items")}
    if "active_ingredient" not in columns:
        op.add_column("inventory_items", sa.Column("active_ingredient", sa.String(120), nullable=False, server_default=""))


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "pharmacy":
        return
    columns = {column["name"] for column in inspect(op.get_bind()).get_columns("inventory_items")}
    if "active_ingredient" in columns:
        op.drop_column("inventory_items", "active_ingredient")
