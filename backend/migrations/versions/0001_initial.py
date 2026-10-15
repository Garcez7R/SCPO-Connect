"""Create the initial table owned by the selected domain service."""

import os

import sqlalchemy as sa
from alembic import op

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    service = os.getenv("SCPO_SERVICE")

    if service == "access":
        op.create_table(
            "demo_users",
            sa.Column("id", sa.String(40), primary_key=True),
            sa.Column("name", sa.String(100), nullable=False),
            sa.Column("role", sa.String(40), nullable=False),
            sa.Column("modules", sa.JSON(), nullable=False),
            sa.Column("permissions", sa.JSON(), nullable=False),
            sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        )
    elif service == "audit":
        op.create_table(
            "audit_events",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("actor_name", sa.String(100), nullable=False),
            sa.Column("actor_role", sa.String(40), nullable=False),
            sa.Column("action", sa.String(60), nullable=False),
            sa.Column("module", sa.String(40), nullable=False),
            sa.Column("target_id", sa.String(40), nullable=False),
            sa.Column("happened_at", sa.DateTime(timezone=True), nullable=False),
        )
    elif service == "nursing":
        op.create_table(
            "vital_records",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("patient_reference", sa.String(32), nullable=False),
            sa.Column("actor_id", sa.String(32), nullable=False),
            sa.Column("values", sa.JSON(), nullable=False),
            sa.Column("glucose_unit", sa.String(12), nullable=False),
            sa.Column("not_applicable", sa.JSON(), nullable=False),
            sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        )
    elif service == "pharmacy":
        op.create_table(
            "inventory_items",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("item_name", sa.String(120), nullable=False),
            sa.Column("balance", sa.String(32), nullable=False),
            sa.Column("unit", sa.String(24), nullable=False),
            sa.Column("lot", sa.String(80), nullable=False),
            sa.Column("expiry_date", sa.Date(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
    elif service == "social":
        op.create_table(
            "social_referrals",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("patient_reference", sa.String(32), nullable=False),
            sa.Column("referral_type", sa.String(80), nullable=False),
            sa.Column("status", sa.String(16), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
    elif service == "xray":
        op.create_table(
            "exam_requests",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("patient_reference", sa.String(32), nullable=False),
            sa.Column("exam_label", sa.String(80), nullable=False),
            sa.Column("status", sa.String(16), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
    elif service == "maintenance":
        # Its domain tables are introduced by the dedicated 0004 migration.
        pass
    elif service == "therapy":
        # Its domain tables are introduced by the dedicated 0007 migration.
        pass
    else:
        raise RuntimeError("SCPO_SERVICE desconhecido")


def downgrade() -> None:
    table_by_service = {
        "access": "demo_users",
        "audit": "audit_events",
        "nursing": "vital_records",
        "pharmacy": "inventory_items",
        "social": "social_referrals",
        "xray": "exam_requests",
    }
    service = os.getenv("SCPO_SERVICE")
    if service in {"maintenance", "therapy"}:
        return
    if service not in table_by_service:
        raise RuntimeError("SCPO_SERVICE desconhecido")
    op.drop_table(table_by_service[service])
