"""Add persistent call cadence settings for reception queues."""

import os

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0045_reception_queue_calls"
down_revision = "0044_waiting_room_service"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return

    bind = op.get_bind()
    arrival_columns = {
        column["name"] for column in inspect(bind).get_columns("emergency_arrivals")
    }
    if "queue_type" not in arrival_columns:
        op.add_column(
            "emergency_arrivals",
            sa.Column(
                "queue_type",
                sa.String(length=12),
                nullable=False,
                server_default="common",
            ),
        )

    if "reception_queue_settings" in inspect(op.get_bind()).get_table_names():
        return

    op.create_table(
        "reception_queue_settings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "normal_before_priority",
            sa.Integer(),
            nullable=False,
            server_default="3",
        ),
        sa.Column(
            "normal_calls_since_priority",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        sa.Column("updated_by", sa.String(length=120), nullable=False, server_default=""),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )
    bind.execute(
        sa.table("reception_queue_settings", sa.column("id", sa.Integer())).insert().values(id=1)
    )


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return

    bind = op.get_bind()
    tables = set(inspect(bind).get_table_names())
    if "reception_queue_settings" in tables:
        op.drop_table("reception_queue_settings")
    if "emergency_arrivals" in tables and "queue_type" in {
        column["name"] for column in inspect(bind).get_columns("emergency_arrivals")
    }:
        op.drop_column("emergency_arrivals", "queue_type")
