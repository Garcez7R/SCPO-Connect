"""Add local accounts for server-issued sessions and mandatory MFA."""

import os

import sqlalchemy as sa
from alembic import op

revision = "0003_local_auth"
down_revision = "0002_patients"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") == "access":
        op.create_table(
            "app_users",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("username", sa.String(80), nullable=False, unique=True),
            sa.Column("name", sa.String(120), nullable=False),
            sa.Column("password_hash", sa.String(255), nullable=False),
            sa.Column("modules", sa.JSON(), nullable=False),
            sa.Column("permissions", sa.JSON(), nullable=False),
            sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("must_change_password", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("mfa_secret_encrypted", sa.String(255), nullable=True),
            sa.Column("mfa_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("failed_attempts", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True),
            sa.Column("session_version", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
    elif os.getenv("SCPO_SERVICE") == "nursing":
        with op.batch_alter_table("vital_records") as batch:
            batch.alter_column("actor_id", existing_type=sa.String(32), type_=sa.String(36), existing_nullable=False)


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") == "access":
        op.drop_table("app_users")
    elif os.getenv("SCPO_SERVICE") == "nursing":
        with op.batch_alter_table("vital_records") as batch:
            batch.alter_column("actor_id", existing_type=sa.String(36), type_=sa.String(32), existing_nullable=False)
