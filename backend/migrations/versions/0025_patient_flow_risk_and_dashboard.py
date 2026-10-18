"""Add patient flow, allergy audit, contraindication, and clinical priority records."""

import os

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0025_patient_flow_risk_and_dashboard"
down_revision = "0024_patient_linked_medications_and_results"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return

    bind = op.get_bind()
    inspector = inspect(bind)
    tables = set(inspector.get_table_names())

    if "patient_flow_events" not in tables:
        op.create_table(
            "patient_flow_events",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "patient_reference",
                sa.String(36),
                sa.ForeignKey("patients.reference", ondelete="RESTRICT"),
                nullable=False,
            ),
            sa.Column("event_type", sa.String(16), nullable=False),
            sa.Column("previous_room", sa.String(20), nullable=False, server_default=""),
            sa.Column("previous_bed", sa.String(20), nullable=False, server_default=""),
            sa.Column("next_room", sa.String(20), nullable=False, server_default=""),
            sa.Column("next_bed", sa.String(20), nullable=False, server_default=""),
            sa.Column("reason", sa.String(500), nullable=False),
            sa.Column("summary", sa.String(2000), nullable=False, server_default=""),
            sa.Column("actor_id", sa.String(36), nullable=False),
            sa.Column("actor_name", sa.String(120), nullable=False),
            sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index(
            "ix_patient_flow_events_patient_occurred",
            "patient_flow_events",
            ["patient_reference", "occurred_at"],
        )

    if "patient_allergy_history" not in tables:
        op.create_table(
            "patient_allergy_history",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "patient_reference",
                sa.String(36),
                sa.ForeignKey("patients.reference", ondelete="RESTRICT"),
                nullable=False,
            ),
            sa.Column("previous_status", sa.String(16), nullable=False),
            sa.Column("previous_details", sa.String(1000), nullable=False, server_default=""),
            sa.Column("new_status", sa.String(16), nullable=False),
            sa.Column("new_details", sa.String(1000), nullable=False, server_default=""),
            sa.Column("reason", sa.String(300), nullable=False),
            sa.Column("actor_id", sa.String(36), nullable=False),
            sa.Column("actor_name", sa.String(120), nullable=False),
            sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index(
            "ix_patient_allergy_history_patient_recorded",
            "patient_allergy_history",
            ["patient_reference", "recorded_at"],
        )

    if "clinical_risks" not in tables:
        op.create_table(
            "clinical_risks",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "patient_reference",
                sa.String(36),
                sa.ForeignKey("patients.reference", ondelete="RESTRICT"),
                nullable=False,
            ),
            sa.Column("risk_type", sa.String(24), nullable=False),
            sa.Column("description", sa.String(1000), nullable=False),
            sa.Column("severity", sa.String(16), nullable=False),
            sa.Column("status", sa.String(16), nullable=False, server_default="active"),
            sa.Column("reason", sa.String(300), nullable=False),
            sa.Column("actor_id", sa.String(36), nullable=False),
            sa.Column("actor_name", sa.String(120), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("resolved_by", sa.String(120), nullable=False, server_default=""),
            sa.Column("resolution_reason", sa.String(300), nullable=False, server_default=""),
        )
        op.create_index(
            "ix_clinical_risks_patient_status",
            "clinical_risks",
            ["patient_reference", "status"],
        )

    arrival_columns = {
        column["name"] for column in inspect(bind).get_columns("emergency_arrivals")
    }
    if "clinical_priority" not in arrival_columns:
        op.add_column(
            "emergency_arrivals",
            sa.Column(
                "clinical_priority",
                sa.String(16),
                nullable=False,
                server_default="unassigned",
            ),
        )
    if "clinical_priority_updated_by" not in arrival_columns:
        op.add_column(
            "emergency_arrivals",
            sa.Column(
                "clinical_priority_updated_by",
                sa.String(120),
                nullable=False,
                server_default="",
            ),
        )
    if "clinical_priority_updated_at" not in arrival_columns:
        op.add_column(
            "emergency_arrivals",
            sa.Column("clinical_priority_updated_at", sa.DateTime(timezone=True)),
        )
    if "clinical_priority_reason" not in arrival_columns:
        op.add_column(
            "emergency_arrivals",
            sa.Column(
                "clinical_priority_reason",
                sa.String(300),
                nullable=False,
                server_default="",
            ),
        )


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return

    bind = op.get_bind()
    inspector = inspect(bind)
    tables = set(inspector.get_table_names())
    if "emergency_arrivals" in tables:
        columns = {
            column["name"]
            for column in inspector.get_columns("emergency_arrivals")
        }
        for name in (
            "clinical_priority_reason",
            "clinical_priority_updated_at",
            "clinical_priority_updated_by",
            "clinical_priority",
        ):
            if name in columns:
                op.drop_column("emergency_arrivals", name)
    for table, index in (
        ("clinical_risks", "ix_clinical_risks_patient_status"),
        ("patient_allergy_history", "ix_patient_allergy_history_patient_recorded"),
        ("patient_flow_events", "ix_patient_flow_events_patient_occurred"),
    ):
        if table in tables:
            op.drop_index(index, table_name=table)
            op.drop_table(table)