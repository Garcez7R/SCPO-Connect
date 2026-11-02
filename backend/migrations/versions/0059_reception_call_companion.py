"""Store the selected companion for reception calls."""

import os

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0059_reception_call_companion"
down_revision = "0058_laundry_inventory"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return

    bind = op.get_bind()
    tables = set(inspect(bind).get_table_names())
    for table in ("emergency_arrivals", "reception_appointments"):
        if table not in tables:
            continue
        columns = {column["name"] for column in inspect(bind).get_columns(table)}
        if "companion_name" not in columns:
            op.add_column(
                table,
                sa.Column(
                    "companion_name",
                    sa.String(length=120),
                    nullable=False,
                    server_default="",
                ),
            )


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return

    bind = op.get_bind()
    tables = set(inspect(bind).get_table_names())
    for table in ("reception_appointments", "emergency_arrivals"):
        if table not in tables:
            continue
        columns = {column["name"] for column in inspect(bind).get_columns(table)}
        if "companion_name" in columns:
            op.drop_column(table, "companion_name")
