"""Add warehouse to global module availability."""

import os

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0069_warehouse_global_module"
down_revision = "0068_warehouse_module"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "access":
        return

    bind = op.get_bind()
    if not inspect(bind).has_table("system_module_settings"):
        return

    settings = sa.table(
        "system_module_settings",
        sa.column("id", sa.Integer()),
        sa.column("module_enabled", sa.JSON()),
    )
    rows = bind.execute(sa.select(settings.c.id, settings.c.module_enabled)).mappings().all()
    for row in rows:
        module_enabled = row["module_enabled"]
        if isinstance(module_enabled, dict) and "warehouse" not in module_enabled:
            op.execute(
                settings.update()
                .where(settings.c.id == row["id"])
                .values(module_enabled={**module_enabled, "warehouse": True})
            )


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "access":
        return

    bind = op.get_bind()
    if not inspect(bind).has_table("system_module_settings"):
        return

    settings = sa.table(
        "system_module_settings",
        sa.column("id", sa.Integer()),
        sa.column("module_enabled", sa.JSON()),
    )
    rows = bind.execute(sa.select(settings.c.id, settings.c.module_enabled)).mappings().all()
    for row in rows:
        module_enabled = row["module_enabled"]
        if isinstance(module_enabled, dict) and "warehouse" in module_enabled:
            updated = {key: value for key, value in module_enabled.items() if key != "warehouse"}
            op.execute(
                settings.update()
                .where(settings.c.id == row["id"])
                .values(module_enabled=updated)
            )
