"""Add a protected system superadministrator account."""

import os

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0026_system_admin"
down_revision = "0025_patient_flow_risk"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "access":
        return

    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("app_users")}
    if "is_superuser" not in columns:
        op.add_column(
            "app_users",
            sa.Column(
                "is_superuser",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            ),
        )

    username = os.getenv("SCPO_SUPERADMIN_USERNAME", "rgarcez").strip().lower()
    bind.execute(
        sa.text("UPDATE app_users SET is_superuser = :value WHERE username = :username"),
        {"value": True, "username": username},
    )
    op.create_index(
        "uq_app_users_single_superuser",
        "app_users",
        ["is_superuser"],
        unique=True,
        sqlite_where=sa.text("is_superuser = 1"),
        postgresql_where=sa.text("is_superuser = true"),
    )


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "access":
        return

    op.drop_index("uq_app_users_single_superuser", table_name="app_users")
    op.drop_column("app_users", "is_superuser")
