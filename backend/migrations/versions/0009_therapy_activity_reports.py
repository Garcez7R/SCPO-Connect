"""Add execution reports and ownership to therapy activities."""

import os

import sqlalchemy as sa
from alembic import op


revision = "0009_therapy_reports"
down_revision = "0008_therapy_calendar"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return
    op.add_column("therapy_activities", sa.Column("activity_report", sa.Text(), nullable=False, server_default=""))
    op.add_column("therapy_activities", sa.Column("report_updated_by", sa.String(120), nullable=True))
    op.add_column("therapy_activities", sa.Column("report_updated_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return
    op.drop_column("therapy_activities", "report_updated_at")
    op.drop_column("therapy_activities", "report_updated_by")
    op.drop_column("therapy_activities", "activity_report")
