"""Add physician profiles, internal prescriptions, and lab request details."""

import os

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0041_medical_orders_lab_exams"
down_revision = "0040_permanent_shares"
branch_labels = None
depends_on = None


def upgrade() -> None:
    service = os.getenv("SCPO_SERVICE")
    bind = op.get_bind()
    tables = set(inspect(bind).get_table_names())

    if service == "nursing":
        if "physician_profiles" not in tables:
            op.create_table(
                "physician_profiles",
                sa.Column("user_id", sa.String(length=36), primary_key=True),
                sa.Column("name", sa.String(length=120), nullable=False),
                sa.Column("crm", sa.String(length=24), nullable=False),
                sa.Column("crm_state", sa.String(length=2), nullable=False),
                sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            )
        if "physician_prescriptions" not in tables:
            op.create_table(
                "physician_prescriptions",
                sa.Column("id", sa.String(length=36), primary_key=True),
                sa.Column("patient_reference", sa.String(length=36), nullable=False),
                sa.Column("medication_name", sa.String(length=160), nullable=False),
                sa.Column("active_ingredient", sa.String(length=160), nullable=False, server_default=""),
                sa.Column("presentation", sa.String(length=160), nullable=False, server_default=""),
                sa.Column("dose", sa.String(length=120), nullable=False),
                sa.Column("route", sa.String(length=80), nullable=False),
                sa.Column("frequency", sa.String(length=160), nullable=False),
                sa.Column("duration", sa.String(length=120), nullable=False),
                sa.Column("quantity", sa.String(length=40), nullable=False),
                sa.Column("unit", sa.String(length=40), nullable=False),
                sa.Column("instructions", sa.String(length=1000), nullable=False, server_default=""),
                sa.Column("is_controlled", sa.Boolean(), nullable=False, server_default=sa.false()),
                sa.Column("prescriber_id", sa.String(length=36), nullable=False),
                sa.Column("prescriber_name", sa.String(length=120), nullable=False),
                sa.Column("crm", sa.String(length=24), nullable=False),
                sa.Column("crm_state", sa.String(length=2), nullable=False),
                sa.Column("status", sa.String(length=16), nullable=False, server_default="pending"),
                sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
                sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            )
            op.create_index(
                "ix_physician_prescriptions_patient_reference",
                "physician_prescriptions",
                ["patient_reference"],
            )
            op.create_index(
                "ix_physician_prescriptions_status_created",
                "physician_prescriptions",
                ["status", "created_at"],
            )

    if service == "xray" and "exam_requests" in tables:
        columns = {column["name"] for column in inspect(bind).get_columns("exam_requests")}
        if "exam_type" not in columns:
            op.add_column(
                "exam_requests",
                sa.Column("exam_type", sa.String(length=16), nullable=False, server_default="xray"),
            )
        if "observations" not in columns:
            op.add_column(
                "exam_requests",
                sa.Column("observations", sa.String(length=1000), nullable=False, server_default=""),
            )


def downgrade() -> None:
    service = os.getenv("SCPO_SERVICE")
    bind = op.get_bind()
    inspector = inspect(bind)

    if service == "nursing":
        tables = set(inspector.get_table_names())
        if "physician_prescriptions" in tables:
            indexes = {index["name"] for index in inspector.get_indexes("physician_prescriptions")}
            for index in (
                "ix_physician_prescriptions_status_created",
                "ix_physician_prescriptions_patient_reference",
            ):
                if index in indexes:
                    op.drop_index(index, table_name="physician_prescriptions")
            op.drop_table("physician_prescriptions")
        if "physician_profiles" in tables:
            op.drop_table("physician_profiles")

    if service == "xray" and "exam_requests" in inspector.get_table_names():
        columns = {column["name"] for column in inspector.get_columns("exam_requests")}
        for column in ("observations", "exam_type"):
            if column in columns:
                op.drop_column("exam_requests", column)
