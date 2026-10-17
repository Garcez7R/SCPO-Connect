"""Add pharmacy stock movements and emergency reception arrivals."""

import os
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0022_stock_movements_emergency_arrivals"
down_revision = "0021_hygiene_requests"
branch_labels = None
depends_on = None


def upgrade() -> None:
    service = os.getenv("SCPO_SERVICE")
    tables = set(inspect(op.get_bind()).get_table_names())

    if service == "pharmacy" and "pharmacy_stock_movements" not in tables:
        op.create_table(
            "pharmacy_stock_movements",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "item_id",
                sa.Integer(),
                sa.ForeignKey("inventory_items.id", ondelete="RESTRICT"),
                nullable=False,
            ),
            sa.Column("movement_type", sa.String(24), nullable=False),
            sa.Column("quantity", sa.String(32), nullable=False),
            sa.Column("balance_after", sa.String(32), nullable=False),
            sa.Column("reason", sa.String(500), nullable=False),
            sa.Column("actor_id", sa.String(36), nullable=False),
            sa.Column("actor_name", sa.String(120), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index(
            "ix_pharmacy_stock_movements_item_created",
            "pharmacy_stock_movements",
            ["item_id", "created_at"],
        )
        op.create_index(
            "ix_pharmacy_stock_movements_created",
            "pharmacy_stock_movements",
            ["created_at"],
        )
        connection = op.get_bind()
        items = connection.execute(
            sa.text(
                "SELECT id, balance, created_at FROM inventory_items ORDER BY id"
            )
        ).mappings()
        for item in items:
            connection.execute(
                sa.text(
                    "INSERT INTO pharmacy_stock_movements "
                    "(item_id, movement_type, quantity, balance_after, reason, "
                    "actor_id, actor_name, created_at) "
                    "VALUES (:item_id, 'opening_balance', :quantity, :balance, "
                    ":reason, '', :actor_name, :created_at)"
                ),
                {
                    "item_id": item["id"],
                    "quantity": item["balance"],
                    "balance": item["balance"],
                    "reason": "Saldo existente antes da ativação do livro de movimentações.",
                    "actor_name": "Saldo legado (migração)",
                    "created_at": item["created_at"] or datetime.now(UTC),
                },
            )

    if service == "nursing" and "emergency_arrivals" not in tables:
        op.create_table(
            "emergency_arrivals",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "patient_reference",
                sa.String(36),
                sa.ForeignKey("patients.reference", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("patient_name", sa.String(120), nullable=False),
            sa.Column("arrival_mode", sa.String(16), nullable=False),
            sa.Column("reason", sa.String(1000), nullable=False),
            sa.Column("status", sa.String(16), nullable=False),
            sa.Column("created_by", sa.String(120), nullable=False),
            sa.Column("updated_by", sa.String(120), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index(
            "ix_emergency_arrivals_status_created",
            "emergency_arrivals",
            ["status", "created_at"],
        )
        op.create_index(
            "ix_emergency_arrivals_patient_created",
            "emergency_arrivals",
            ["patient_reference", "created_at"],
        )


def downgrade() -> None:
    service = os.getenv("SCPO_SERVICE")
    tables = set(inspect(op.get_bind()).get_table_names())
    if service == "nursing" and "emergency_arrivals" in tables:
        op.drop_index(
            "ix_emergency_arrivals_patient_created",
            table_name="emergency_arrivals",
        )
        op.drop_index(
            "ix_emergency_arrivals_status_created",
            table_name="emergency_arrivals",
        )
        op.drop_table("emergency_arrivals")
    if service == "pharmacy" and "pharmacy_stock_movements" in tables:
        op.drop_index(
            "ix_pharmacy_stock_movements_created",
            table_name="pharmacy_stock_movements",
        )
        op.drop_index(
            "ix_pharmacy_stock_movements_item_created",
            table_name="pharmacy_stock_movements",
        )
        op.drop_table("pharmacy_stock_movements")
