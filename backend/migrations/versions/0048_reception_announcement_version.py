"""Track public call announcements independently from queue status updates."""

import os

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0048_reception_announce"
down_revision = "0047_nursing_triage"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return

    bind = op.get_bind()
    tables = set(inspect(bind).get_table_names())
    for table in ("emergency_arrivals", "reception_appointments"):
        if table not in tables:
            continue
        columns = {column["name"] for column in inspect(bind).get_columns(table)}
        if "announcement_version" not in columns:
            op.add_column(
                table,
                sa.Column(
                    "announcement_version",
                    sa.Integer(),
                    nullable=False,
                    server_default="0",
                ),
            )


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return

    bind = op.get_bind()
    tables = set(inspect(bind).get_table_names())
    for table in ("reception_appointments", "emergency_arrivals"):
        if table not in tables:
            continue
        columns = {column["name"] for column in inspect(bind).get_columns(table)}
        if "announcement_version" in columns:
            op.drop_column(table, "announcement_version")
