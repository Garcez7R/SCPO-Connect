"""Store vital measurement time separately from record creation time."""

import os

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect, text

revision = "0030_vital_measurement_time"
down_revision = "0029_pharmacy_products"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return

    bind = op.get_bind()
    if "vital_records" not in inspect(bind).get_table_names():
        return

    columns = {column["name"] for column in inspect(bind).get_columns("vital_records")}
    if "measured_at" not in columns:
        op.add_column(
            "vital_records",
            sa.Column("measured_at", sa.DateTime(timezone=True), nullable=True),
        )
    bind.execute(
        text("UPDATE vital_records SET measured_at = recorded_at WHERE measured_at IS NULL")
    )
    indexes = {index["name"] for index in inspect(bind).get_indexes("vital_records")}
    if "ix_vital_records_patient_measured_at" not in indexes:
        op.create_index(
            "ix_vital_records_patient_measured_at",
            "vital_records",
            ["patient_reference", "measured_at"],
        )


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return

    bind = op.get_bind()
    if "vital_records" not in inspect(bind).get_table_names():
        return

    indexes = {index["name"] for index in inspect(bind).get_indexes("vital_records")}
    if "ix_vital_records_patient_measured_at" in indexes:
        op.drop_index("ix_vital_records_patient_measured_at", table_name="vital_records")
    columns = {column["name"] for column in inspect(bind).get_columns("vital_records")}
    if "measured_at" in columns:
        op.drop_column("vital_records", "measured_at")
