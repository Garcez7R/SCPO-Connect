"""Add the configured average stock target for pharmacy inventory."""

import os

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect


revision = "0017_pharmacy_average_balance"
down_revision = "0016_patient_observations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "pharmacy":
        return
    columns = {column["name"] for column in inspect(op.get_bind()).get_columns("inventory_items")}
    if "average_balance" not in columns:
        op.add_column("inventory_items", sa.Column("average_balance", sa.String(32), nullable=False, server_default="0"))


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "pharmacy":
        return
    columns = {column["name"] for column in inspect(op.get_bind()).get_columns("inventory_items")}
    if "average_balance" in columns:
        op.drop_column("inventory_items", "average_balance")
