"""Persist Anvisa catalog automatic update state."""

import os

import sqlalchemy as sa
from alembic import op

revision = "0065_anvisa_auto_state"
down_revision = "0064_pharmacy_packaging"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "pharmacy":
        return
    bind = op.get_bind()
    if not sa.inspect(bind).has_table("anvisa_catalog_update_state"):
        op.create_table(
            "anvisa_catalog_update_state",
            sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
            sa.Column("automatic_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("run_time", sa.String(length=5), nullable=False, server_default="00:00"),
            sa.Column("timezone_name", sa.String(length=40), nullable=False, server_default="America/Sao_Paulo"),
            sa.Column("last_attempt_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_success_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_entry_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("last_error", sa.String(length=240), nullable=False, server_default=""),
        )


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "pharmacy":
        return
    bind = op.get_bind()
    if sa.inspect(bind).has_table("anvisa_catalog_update_state"):
        op.drop_table("anvisa_catalog_update_state")
