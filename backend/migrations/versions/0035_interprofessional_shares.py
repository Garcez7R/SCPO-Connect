"""Create purpose-limited, auditable information shares between care teams."""

import os

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0035_interprofessional_shares"
down_revision = "0034_reception_encounters"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "social":
        return

    inspector = inspect(op.get_bind())
    if "interprofessional_shares" not in inspector.get_table_names():
        op.create_table(
            "interprofessional_shares",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("patient_reference", sa.String(36), nullable=False, index=True),
            sa.Column("sender_module", sa.String(16), nullable=False),
            sa.Column("recipient_module", sa.String(16), nullable=False),
            sa.Column("categories", sa.JSON(), nullable=False),
            sa.Column("summary", sa.Text(), nullable=False),
            sa.Column("purpose", sa.String(300), nullable=False),
            sa.Column("created_by", sa.String(36), nullable=False),
            sa.Column("created_by_name", sa.String(120), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("revoked_by", sa.String(36), nullable=True),
        )
        op.create_index(
            "ix_interprofessional_shares_recipient_expiry",
            "interprofessional_shares",
            ["recipient_module", "expires_at"],
        )
        op.create_index(
            "ix_interprofessional_shares_creator",
            "interprofessional_shares",
            ["created_by", "sender_module"],
        )


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "social":
        return

    inspector = inspect(op.get_bind())
    if "interprofessional_shares" in inspector.get_table_names():
        indexes = {index["name"] for index in inspector.get_indexes("interprofessional_shares")}
        for name in ("ix_interprofessional_shares_creator", "ix_interprofessional_shares_recipient_expiry"):
            if name in indexes:
                op.drop_index(name, table_name="interprofessional_shares")
        op.drop_table("interprofessional_shares")
