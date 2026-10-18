"""Add patient-linked medication dispensations, nursing administration, and radiology results."""

import os

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0024_patient_med_results"
down_revision = "0023_patient_allergy_status"
branch_labels = None
depends_on = None


def upgrade() -> None:
    service = os.getenv("SCPO_SERVICE")
    tables = set(inspect(op.get_bind()).get_table_names())
    if service == "pharmacy" and "medication_dispensations" not in tables:
        op.create_table(
            "medication_dispensations",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("patient_reference", sa.String(36), nullable=False),
            sa.Column(
                "item_id",
                sa.Integer(),
                sa.ForeignKey("inventory_items.id", ondelete="RESTRICT"),
                nullable=False,
            ),
            sa.Column("medication_name", sa.String(120), nullable=False),
            sa.Column("quantity", sa.String(32), nullable=False),
            sa.Column("unit", sa.String(24), nullable=False),
            sa.Column("instructions", sa.String(500), nullable=False, server_default=""),
            sa.Column("prescription_reference", sa.String(80), nullable=False, server_default=""),
            sa.Column("prescriber_name", sa.String(120), nullable=False, server_default=""),
            sa.Column("allergy_reviewed", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("status", sa.String(16), nullable=False, server_default="dispensed"),
            sa.Column("actor_id", sa.String(36), nullable=False),
            sa.Column("actor_name", sa.String(120), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index(
            "ix_medication_dispensations_patient_reference",
            "medication_dispensations",
            ["patient_reference"],
        )
    if service == "nursing" and "medication_administrations" not in tables:
        op.create_table(
            "medication_administrations",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("dispensation_id", sa.String(36), nullable=False, unique=True),
            sa.Column("patient_reference", sa.String(36), nullable=False),
            sa.Column("medication_name", sa.String(120), nullable=False),
            sa.Column("dose", sa.String(80), nullable=False),
            sa.Column("unit", sa.String(24), nullable=False),
            sa.Column("status", sa.String(16), nullable=False),
            sa.Column("reason", sa.String(500), nullable=False, server_default=""),
            sa.Column("actor_id", sa.String(36), nullable=False),
            sa.Column("actor_name", sa.String(120), nullable=False),
            sa.Column("administered_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index(
            "ix_medication_administrations_patient_administered",
            "medication_administrations",
            ["patient_reference", "administered_at"],
        )
    if service == "xray" and "exam_requests" in tables:
        columns = {column["name"] for column in inspect(op.get_bind()).get_columns("exam_requests")}
        if "result" not in columns:
            op.add_column(
                "exam_requests",
                sa.Column("result", sa.String(4000), nullable=False, server_default=""),
            )
            op.add_column(
                "exam_requests",
                sa.Column("result_recorded_by", sa.String(120), nullable=False, server_default=""),
            )
            op.add_column(
                "exam_requests",
                sa.Column("result_recorded_at", sa.DateTime(timezone=True), nullable=True),
            )


def downgrade() -> None:
    service = os.getenv("SCPO_SERVICE")
    tables = set(inspect(op.get_bind()).get_table_names())
    if service == "pharmacy" and "medication_dispensations" in tables:
        op.drop_index(
            "ix_medication_dispensations_patient_reference",
            table_name="medication_dispensations",
        )
        op.drop_table("medication_dispensations")
    if service == "nursing" and "medication_administrations" in tables:
        op.drop_index(
            "ix_medication_administrations_patient_administered",
            table_name="medication_administrations",
        )
        op.drop_table("medication_administrations")
    if service == "xray" and "exam_requests" in tables:
        columns = {column["name"] for column in inspect(op.get_bind()).get_columns("exam_requests")}
        for column in ("result_recorded_at", "result_recorded_by", "result"):
            if column in columns:
                op.drop_column("exam_requests", column)
