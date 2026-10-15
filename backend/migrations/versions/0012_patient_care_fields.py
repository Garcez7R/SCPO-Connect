"""Add patient safety, care tracking and audit-aware archive fields."""

import os

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect


revision = "0012_patient_care_fields"
down_revision = "0011_patient_integrity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return
    bind = op.get_bind()
    inspector = inspect(bind)
    additions = {
        "patients": [
            sa.Column("sus_card", sa.String(20), nullable=False, server_default=""),
            sa.Column("allergies", sa.String(1000), nullable=False, server_default=""),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("deleted_by", sa.String(120), nullable=False, server_default=""),
            sa.Column("deletion_reason", sa.String(500), nullable=False, server_default=""),
        ],
        "vital_records": [
            sa.Column("voided_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("voided_by", sa.String(120), nullable=False, server_default=""),
            sa.Column("void_reason", sa.String(500), nullable=False, server_default=""),
        ],
        "nutrition_records": [
            sa.Column("fasting_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("fasting_reason", sa.String(500), nullable=False, server_default=""),
            sa.Column("voided_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("voided_by", sa.String(120), nullable=False, server_default=""),
            sa.Column("void_reason", sa.String(500), nullable=False, server_default=""),
        ],
    }
    for table, columns in additions.items():
        existing = {column["name"] for column in inspect(bind).get_columns(table)}
        for column in columns:
            if column.name not in existing:
                op.add_column(table, column)
    indexes = {index["name"] for index in inspect(bind).get_indexes("patients")}
    if "uq_patients_sus_card_nonempty" not in indexes:
        op.create_index(
            "uq_patients_sus_card_nonempty", "patients", ["sus_card"], unique=True,
            sqlite_where=sa.text("sus_card <> ''"), postgresql_where=sa.text("sus_card <> ''"),
        )


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return
    op.drop_index("uq_patients_sus_card_nonempty", table_name="patients")
    for table, columns in {
        "nutrition_records": ("void_reason", "voided_by", "voided_at", "fasting_reason", "fasting_at"),
        "vital_records": ("void_reason", "voided_by", "voided_at"),
        "patients": ("deletion_reason", "deleted_by", "deleted_at", "allergies", "sus_card"),
    }.items():
        for column in columns:
            op.drop_column(table, column)
