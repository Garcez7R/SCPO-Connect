"""Add operational follow-up to social referrals and group attendance to therapy."""

import os

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0039_social_therapy_workflows"
down_revision = "0038_patient_same_number"
branch_labels = None
depends_on = None


def upgrade() -> None:
    service = os.getenv("SCPO_SERVICE")
    inspector = inspect(op.get_bind())
    tables = set(inspector.get_table_names())

    if service == "social" and "social_referrals" in tables:
        columns = {column["name"] for column in inspector.get_columns("social_referrals")}
        additions = (
            ("priority", sa.String(16), "routine"),
            ("assignee", sa.String(120), ""),
            ("follow_up_due", sa.Date(), None),
            ("next_step", sa.String(300), ""),
        )
        for name, column_type, default in additions:
            if name not in columns:
                op.add_column(
                    "social_referrals",
                    sa.Column(name, column_type, nullable=name == "follow_up_due", server_default=default),
                )

    if service == "nursing" and "therapy_activities" in tables and "therapy_activity_attendance" not in tables:
        op.create_table(
            "therapy_activity_attendance",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "activity_id",
                sa.String(36),
                sa.ForeignKey("therapy_activities.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "patient_reference",
                sa.String(36),
                sa.ForeignKey("patients.reference", ondelete="RESTRICT"),
                nullable=False,
            ),
            sa.Column("attendance", sa.String(16), nullable=False, server_default="pending"),
            sa.UniqueConstraint("activity_id", "patient_reference", name="uq_therapy_attendance_activity_patient"),
        )
        op.create_index(
            "ix_therapy_activity_attendance_patient",
            "therapy_activity_attendance",
            ["patient_reference"],
        )


def downgrade() -> None:
    service = os.getenv("SCPO_SERVICE")
    inspector = inspect(op.get_bind())
    tables = set(inspector.get_table_names())

    if service == "social" and "social_referrals" in tables:
        columns = {column["name"] for column in inspector.get_columns("social_referrals")}
        for name in ("next_step", "follow_up_due", "assignee", "priority"):
            if name in columns:
                op.drop_column("social_referrals", name)

    if service == "nursing" and "therapy_activity_attendance" in tables:
        indexes = {index["name"] for index in inspector.get_indexes("therapy_activity_attendance")}
        if "ix_therapy_activity_attendance_patient" in indexes:
            op.drop_index("ix_therapy_activity_attendance_patient", table_name="therapy_activity_attendance")
        op.drop_table("therapy_activity_attendance")
