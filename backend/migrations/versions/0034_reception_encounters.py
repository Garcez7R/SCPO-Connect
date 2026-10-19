"""Add reusable patient identity fields and outpatient reception encounters."""

import os

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0034_reception_encounters"
down_revision = "0033_admin_ops"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return

    bind = op.get_bind()
    inspector = inspect(bind)
    tables = set(inspector.get_table_names())
    if "patients" in tables:
        columns = {column["name"] for column in inspector.get_columns("patients")}
        for name in ("mother_name", "health_plan"):
            if name not in columns:
                op.add_column(
                    "patients",
                    sa.Column(name, sa.String(120), nullable=False, server_default=""),
                )

    if "outpatient_encounters" not in tables:
        op.create_table(
            "outpatient_encounters",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "patient_reference",
                sa.String(36),
                sa.ForeignKey("patients.reference", ondelete="RESTRICT"),
                nullable=False,
            ),
            sa.Column("patient_snapshot", sa.JSON(), nullable=False),
            sa.Column("encounter_type", sa.String(32), nullable=False),
            sa.Column("physician_name", sa.String(120), nullable=False, server_default=""),
            sa.Column("examination", sa.String(1000), nullable=False, server_default=""),
            sa.Column("activity_rows", sa.JSON(), nullable=False),
            sa.Column("group_name", sa.String(120), nullable=False, server_default=""),
            sa.Column("programs", sa.JSON(), nullable=False),
            sa.Column("diagnostic_hypothesis", sa.String(2000), nullable=False, server_default=""),
            sa.Column("antibiotic_prescription", sa.String(2000), nullable=False, server_default=""),
            sa.Column("referral", sa.String(32), nullable=False),
            sa.Column("created_by", sa.String(120), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index(
            "ix_outpatient_encounters_patient_created",
            "outpatient_encounters",
            ["patient_reference", "created_at"],
        )


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return

    bind = op.get_bind()
    tables = set(inspect(bind).get_table_names())
    if "outpatient_encounters" in tables:
        indexes = {index["name"] for index in inspect(bind).get_indexes("outpatient_encounters")}
        if "ix_outpatient_encounters_patient_created" in indexes:
            op.drop_index(
                "ix_outpatient_encounters_patient_created",
                table_name="outpatient_encounters",
            )
        op.drop_table("outpatient_encounters")
    if "patients" in tables:
        columns = {column["name"] for column in inspect(bind).get_columns("patients")}
        for name in ("health_plan", "mother_name"):
            if name in columns:
                op.drop_column("patients", name)
