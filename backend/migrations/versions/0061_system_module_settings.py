"""Persist global module availability and maintenance state."""

import os
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0061_system_module_settings"
down_revision = "0060_shared_patient_record"
branch_labels = None
depends_on = None

MODULES = (
    "patients",
    "nursing",
    "pharmacy",
    "xray",
    "physician",
    "social",
    "nutrition",
    "hygiene",
    "reception",
    "therapy",
    "psychology",
    "maintenance",
    "management",
    "admin",
    "laundry",
)


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "access":
        return

    if "system_module_settings" in inspect(op.get_bind()).get_table_names():
        return

    op.create_table(
        "system_module_settings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("module_enabled", sa.JSON(), nullable=False),
        sa.Column(
            "maintenance_mode",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_by_id", sa.String(length=36), nullable=False),
        sa.Column("updated_by_name", sa.String(length=120), nullable=False),
    )
    settings_table = sa.table(
        "system_module_settings",
        sa.column("id", sa.Integer()),
        sa.column("module_enabled", sa.JSON()),
        sa.column("maintenance_mode", sa.Boolean()),
        sa.column("updated_at", sa.DateTime(timezone=True)),
        sa.column("updated_by_id", sa.String(length=36)),
        sa.column("updated_by_name", sa.String(length=120)),
    )
    op.bulk_insert(
        settings_table,
        [
            {
                "id": 1,
                "module_enabled": {module: True for module in MODULES},
                "maintenance_mode": False,
                "updated_at": datetime.now(UTC),
                "updated_by_id": "system",
                "updated_by_name": "Instalação inicial",
            }
        ],
    )


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "access":
        return

    if "system_module_settings" in inspect(op.get_bind()).get_table_names():
        op.drop_table("system_module_settings")
