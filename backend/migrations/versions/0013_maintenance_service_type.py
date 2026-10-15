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
    work_orders = sa.table(
        "work_orders",
        sa.column("id", sa.Integer()),
        sa.column("description", sa.Text()),
        sa.column("service_type", sa.String(80)),
    )
    rows = bind.execute(
        sa.select(work_orders.c.id, work_orders.c.description).where(
            work_orders.c.description.like("Categoria:%")
        )
    ).all()
    for order_id, description in rows:
        service_type = description.splitlines()[0][len("Categoria:"):].strip()[:80]
        if service_type:
            bind.execute(
                work_orders.update()
                .where(work_orders.c.id == order_id)
                .values(service_type=service_type)
            )


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "maintenance":
        return
    if "service_type" in {column["name"] for column in inspect(op.get_bind()).get_columns("work_orders")}:
        op.drop_column("work_orders", "service_type")
