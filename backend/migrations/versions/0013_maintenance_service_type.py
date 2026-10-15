"""Add a searchable service category to work orders."""

import os

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect


revision = "0013_maintenance_service_type"
down_revision = "0012_patient_care_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "maintenance":
        return
    if "service_type" not in {column["name"] for column in inspect(op.get_bind()).get_columns("work_orders")}:
        op.add_column("work_orders", sa.Column("service_type", sa.String(80), nullable=False, server_default="Outro serviço"))
    bind = op.get_bind()
    bind.execute(sa.text("UPDATE work_orders SET service_type = substring(description from '^Categoria: ([^\\n]+)') WHERE description LIKE 'Categoria:%'"))


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "maintenance":
        return
    if "service_type" in {column["name"] for column in inspect(op.get_bind()).get_columns("work_orders")}:
        op.drop_column("work_orders", "service_type")
