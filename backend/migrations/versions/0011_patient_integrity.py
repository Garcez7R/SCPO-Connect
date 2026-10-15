"""Enforce patient identity and occupancy rules and expand module references."""

import os
import re

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect


revision = "0011_patient_integrity"
down_revision = "0010_patient_cpf_nutrition"
branch_labels = None
depends_on = None


def upgrade() -> None:
    service = os.getenv("SCPO_SERVICE")
    bind = op.get_bind()
    inspector = inspect(bind)
    if service == "nursing":
        for reference, cpf, room, bed in bind.execute(sa.text("SELECT reference, cpf, room, bed FROM patients")):
            normalized_cpf = re.sub(r"\D", "", cpf or "")
            normalized_room = (room or "").strip()
            normalized_bed = (bed or "").strip()
            if normalized_cpf != cpf or normalized_room != room or normalized_bed != bed:
                bind.execute(sa.text(
                    "UPDATE patients SET cpf = :cpf, room = :room, bed = :bed WHERE reference = :reference"
                ), {"cpf": normalized_cpf, "room": normalized_room, "bed": normalized_bed, "reference": reference})
        # Keep the migration safe for existing deployments: fail with a clear
        # message instead of silently changing duplicate or orphaned records.
        duplicates = bind.execute(sa.text(
            "SELECT COUNT(*) FROM (SELECT cpf FROM patients WHERE cpf <> '' GROUP BY cpf HAVING COUNT(*) > 1)"
        )).scalar_one()
        occupied = bind.execute(sa.text(
            "SELECT COUNT(*) FROM (SELECT room, bed FROM patients WHERE active = true GROUP BY room, bed HAVING COUNT(*) > 1)"
        )).scalar_one()
        if duplicates or occupied:
            raise RuntimeError(
                f"Corrija {duplicates} CPF(s) duplicado(s) e {occupied} conflito(s) de quarto/leito antes da migração"
            )
        if not any(index["name"] == "uq_patients_cpf_nonempty" for index in inspector.get_indexes("patients")):
            op.create_index(
                "uq_patients_cpf_nonempty", "patients", ["cpf"], unique=True,
                sqlite_where=sa.text("cpf <> ''"), postgresql_where=sa.text("cpf <> ''"),
            )
        if not any(index["name"] == "uq_patients_active_room_bed" for index in inspector.get_indexes("patients")):
            op.create_index(
                "uq_patients_active_room_bed", "patients", ["room", "bed"], unique=True,
                sqlite_where=sa.text("active = 1"), postgresql_where=sa.text("active = true"),
            )
        for table, column in (("vital_records", "patient_reference"), ("nutrition_records", "patient_reference"), ("therapy_activities", "patient_reference")):
            if not inspector.has_table(table):
                continue
            has_fk = any(fk.get("referred_table") == "patients" and fk.get("constrained_columns") == [column] for fk in inspector.get_foreign_keys(table))
            if has_fk:
                continue
            orphaned = bind.execute(sa.text(
                f"SELECT COUNT(*) FROM {table} r LEFT JOIN patients p ON p.reference = r.{column} WHERE r.{column} IS NOT NULL AND p.reference IS NULL"
            )).scalar_one()
            if orphaned:
                raise RuntimeError(f"Corrija {orphaned} vínculo(s) de paciente inexistente na tabela {table} antes da migração")
            with op.batch_alter_table(table) as batch:
                batch.create_foreign_key(f"fk_{table}_patient", "patients", [column], ["reference"], ondelete="RESTRICT")
    elif service in {"social", "xray"}:
        table = "social_referrals" if service == "social" else "exam_requests"
        if inspector.has_table(table):
            column = next(item for item in inspector.get_columns(table) if item["name"] == "patient_reference")
            if getattr(column["type"], "length", None) != 36:
                with op.batch_alter_table(table) as batch:
                    batch.alter_column("patient_reference", existing_type=sa.String(32), type_=sa.String(36), existing_nullable=False)
            index_name = f"ix_{table}_patient_reference"
            if not any(index["name"] == index_name for index in inspect(op.get_bind()).get_indexes(table)):
                op.create_index(index_name, table, ["patient_reference"])
    elif service == "maintenance" and inspector.has_table("work_orders"):
        columns = {column["name"] for column in inspector.get_columns("work_orders")}
        if "patient_reference" not in columns:
            op.add_column("work_orders", sa.Column("patient_reference", sa.String(36), nullable=True))
            op.create_index("ix_work_orders_patient_reference", "work_orders", ["patient_reference"])


def downgrade() -> None:
    service = os.getenv("SCPO_SERVICE")
    if service == "nursing":
        for table in ("vital_records", "nutrition_records", "therapy_activities"):
            if not inspect(op.get_bind()).has_table(table):
                continue
            foreign_keys = inspect(op.get_bind()).get_foreign_keys(table)
            constraint = next((fk["name"] for fk in foreign_keys if fk.get("referred_table") == "patients"), None)
            if constraint:
                with op.batch_alter_table(table) as batch:
                    batch.drop_constraint(constraint, type_="foreignkey")
        op.drop_index("uq_patients_active_room_bed", table_name="patients")
        op.drop_index("uq_patients_cpf_nonempty", table_name="patients")
    elif service == "maintenance":
        op.drop_index("ix_work_orders_patient_reference", table_name="work_orders")
        op.drop_column("work_orders", "patient_reference")
    elif service in {"social", "xray"}:
        table = "social_referrals" if service == "social" else "exam_requests"
        index_name = f"ix_{table}_patient_reference"
        if any(index["name"] == index_name for index in inspect(op.get_bind()).get_indexes(table)):
            op.drop_index(index_name, table_name=table)
