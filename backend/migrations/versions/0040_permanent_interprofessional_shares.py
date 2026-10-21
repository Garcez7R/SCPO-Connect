"""Allow interprofessional shares without an automatic expiration."""

import os

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0040_permanent_shares"
down_revision = "0039_social_therapy_workflows"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "social":
        return

    inspector = inspect(op.get_bind())
    if "interprofessional_shares" not in inspector.get_table_names():
        return
    columns = {column["name"]: column for column in inspector.get_columns("interprofessional_shares")}
    expires_at = columns.get("expires_at")
    if expires_at and not expires_at["nullable"]:
        with op.batch_alter_table("interprofessional_shares") as batch_op:
            batch_op.alter_column(
                "expires_at",
                existing_type=sa.DateTime(timezone=True),
                nullable=True,
            )


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "social":
        return

    inspector = inspect(op.get_bind())
    if "interprofessional_shares" not in inspector.get_table_names():
        return
    columns = {column["name"]: column for column in inspector.get_columns("interprofessional_shares")}
    expires_at = columns.get("expires_at")
    if expires_at and expires_at["nullable"]:
        op.execute(
            sa.text(
                "UPDATE interprofessional_shares "
                "SET expires_at = '9999-12-31 23:59:59+00:00' "
                "WHERE expires_at IS NULL"
            )
        )
        with op.batch_alter_table("interprofessional_shares") as batch_op:
            batch_op.alter_column(
                "expires_at",
                existing_type=sa.DateTime(timezone=True),
                nullable=False,
            )
