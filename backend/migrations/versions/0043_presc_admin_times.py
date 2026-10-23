"""Store clinician-entered medication administration times."""

import os

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0043_presc_admin_times"
down_revision = "0042_nursing_hourly_rounds"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return

    inspector = inspect(op.get_bind())
    if "physician_prescriptions" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("physician_prescriptions")}
    if "administration_times" not in columns:
        op.add_column(
            "physician_prescriptions",
            sa.Column(
                "administration_times",
                sa.JSON(),
                nullable=False,
                server_default=sa.text("'[]'"),
            ),
        )


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return

    inspector = inspect(op.get_bind())
    if "physician_prescriptions" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("physician_prescriptions")}
    if "administration_times" in columns:
        op.drop_column("physician_prescriptions", "administration_times")
