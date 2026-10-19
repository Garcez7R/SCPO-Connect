"""Store inpatient care track and reported emergency allergies."""

import os

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0032_inpatient_care"
down_revision = "0031_repeat_med_admin"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return

    bind = op.get_bind()
    tables = set(inspect(bind).get_table_names())
    if "patients" in tables:
        columns = {column["name"] for column in inspect(bind).get_columns("patients")}
        if "treatment_track" not in columns:
            op.add_column(
                "patients",
                sa.Column(
                    "treatment_track",
                    sa.String(20),
                    nullable=False,
                    server_default="unclassified",
                ),
            )
    if "emergency_arrivals" in tables:
        columns = {
            column["name"]
            for column in inspect(bind).get_columns("emergency_arrivals")
        }
        if "allergy_report_status" not in columns:
            op.add_column(
                "emergency_arrivals",
                sa.Column(
                    "allergy_report_status",
                    sa.String(16),
                    nullable=False,
                    server_default="not_asked",
                ),
            )
        if "reported_allergies" not in columns:
            op.add_column(
                "emergency_arrivals",
                sa.Column(
                    "reported_allergies",
                    sa.String(500),
                    nullable=False,
                    server_default="",
                ),
            )


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return

    bind = op.get_bind()
    tables = set(inspect(bind).get_table_names())
    if "emergency_arrivals" in tables:
        columns = {
            column["name"]
            for column in inspect(bind).get_columns("emergency_arrivals")
        }
        if "reported_allergies" in columns:
            op.drop_column("emergency_arrivals", "reported_allergies")
        if "allergy_report_status" in columns:
            op.drop_column("emergency_arrivals", "allergy_report_status")
    if "patients" in tables:
        columns = {column["name"] for column in inspect(bind).get_columns("patients")}
        if "treatment_track" in columns:
            op.drop_column("patients", "treatment_track")
