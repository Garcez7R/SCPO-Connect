"""Add provisional patient aliases and shared clinical record entries."""

import os

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0060_shared_patient_record"
down_revision = "0059_reception_call_companion"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return

    bind = op.get_bind()
    inspector = inspect(bind)
    if "patients" in inspector.get_table_names():
        occupied_duplicates = bind.execute(
            sa.text(
                """
                SELECT COUNT(*) FROM (
                    SELECT room, bed
                    FROM patients
                    WHERE active = true AND trim(room) <> '' AND trim(bed) <> ''
                    GROUP BY room, bed
                    HAVING COUNT(*) > 1
                )
                """
            )
        ).scalar_one()
        if occupied_duplicates:
            raise RuntimeError(
                "Corrija os conflitos de quarto/leito antes de atualizar o índice de pacientes"
            )
        indexes = {index["name"] for index in inspector.get_indexes("patients")}
        if "uq_patients_active_room_bed" in indexes:
            op.drop_index("uq_patients_active_room_bed", table_name="patients")
        op.create_index(
            "uq_patients_active_room_bed",
            "patients",
            ["room", "bed"],
            unique=True,
            sqlite_where=sa.text(
                "active = 1 AND trim(room) <> '' AND trim(bed) <> ''"
            ),
            postgresql_where=sa.text(
                "active = true AND trim(room) <> '' AND trim(bed) <> ''"
            ),
        )
        columns = {column["name"] for column in inspector.get_columns("patients")}
        if "is_provisional" not in columns:
            op.add_column(
                "patients",
                sa.Column(
                    "is_provisional",
                    sa.Boolean(),
                    nullable=False,
                    server_default=sa.false(),
                ),
            )

    tables = set(inspect(bind).get_table_names())
    if "patient_merge_aliases" not in tables:
        op.create_table(
            "patient_merge_aliases",
            sa.Column(
                "source_reference",
                sa.String(length=36),
                sa.ForeignKey("patients.reference", ondelete="RESTRICT"),
                primary_key=True,
            ),
            sa.Column(
                "target_reference",
                sa.String(length=36),
                sa.ForeignKey("patients.reference", ondelete="RESTRICT"),
                nullable=False,
            ),
            sa.Column("merged_by_id", sa.String(length=36), nullable=False),
            sa.Column("merged_by_name", sa.String(length=120), nullable=False),
            sa.Column("merged_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index(
            "ix_patient_merge_aliases_target",
            "patient_merge_aliases",
            ["target_reference"],
        )

    if "patient_record_entries" not in tables:
        op.create_table(
            "patient_record_entries",
            sa.Column("id", sa.String(length=36), primary_key=True),
            sa.Column(
                "patient_reference",
                sa.String(length=36),
                sa.ForeignKey("patients.reference", ondelete="RESTRICT"),
                nullable=False,
            ),
            sa.Column("entry_type", sa.String(length=24), nullable=False),
            sa.Column("evolution", sa.Text(), nullable=False),
            sa.Column("diagnosis", sa.Text(), nullable=False, server_default=""),
            sa.Column("conduct", sa.Text(), nullable=False, server_default=""),
            sa.Column("actor_id", sa.String(length=36), nullable=False),
            sa.Column("actor_name", sa.String(length=120), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index(
            "ix_patient_record_entries_patient_created",
            "patient_record_entries",
            ["patient_reference", "created_at"],
        )


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return

    bind = op.get_bind()
    tables = set(inspect(bind).get_table_names())
    if "patients" in tables:
        unassigned_duplicates = bind.execute(
            sa.text(
                """
                SELECT COUNT(*) FROM (
                    SELECT room, bed
                    FROM patients
                    WHERE active = true
                    GROUP BY room, bed
                    HAVING COUNT(*) > 1
                )
                """
            )
        ).scalar_one()
        if unassigned_duplicates:
            raise RuntimeError(
                "Não é possível reverter: há múltiplos pacientes ativos sem acomodação"
            )
        op.drop_index("uq_patients_active_room_bed", table_name="patients")
        op.create_index(
            "uq_patients_active_room_bed",
            "patients",
            ["room", "bed"],
            unique=True,
            sqlite_where=sa.text("active = 1"),
            postgresql_where=sa.text("active = true"),
        )
    if "patient_record_entries" in tables:
        op.drop_table("patient_record_entries")
    if "patient_merge_aliases" in tables:
        op.drop_table("patient_merge_aliases")
    if "patients" in tables:
        columns = {column["name"] for column in inspect(bind).get_columns("patients")}
        if "is_provisional" in columns:
            op.drop_column("patients", "is_provisional")
