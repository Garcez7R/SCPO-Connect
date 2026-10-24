"""Add nursing elopement flags, arrival timestamps, and compact service numbers."""

import os

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0044_waiting_room_service"
down_revision = "0043_presc_admin_times"
branch_labels = None
depends_on = None


def upgrade() -> None:
    service = os.getenv("SCPO_SERVICE")
    bind = op.get_bind()
    inspector = inspect(bind)
    tables = set(inspector.get_table_names())

    if service == "nursing":
        patient_columns = {
            column["name"] for column in inspector.get_columns("patients")
        }
        if "elopement_risk" not in patient_columns:
            op.add_column(
                "patients",
                sa.Column(
                    "elopement_risk",
                    sa.Boolean(),
                    nullable=False,
                    server_default=sa.true(),
                ),
            )

        round_patient_columns = {
            column["name"]
            for column in inspector.get_columns("nursing_hourly_round_patients")
        }
        if "elopement_risk" not in round_patient_columns:
            op.add_column(
                "nursing_hourly_round_patients",
                sa.Column(
                    "elopement_risk",
                    sa.Boolean(),
                    nullable=False,
                    server_default=sa.true(),
                ),
            )

        appointment_columns = {
            column["name"]
            for column in inspector.get_columns("reception_appointments")
        }
        if "arrived_at" not in appointment_columns:
            op.add_column(
                "reception_appointments",
                sa.Column("arrived_at", sa.DateTime(timezone=True), nullable=True),
            )
            bind.execute(
                sa.text(
                    "UPDATE reception_appointments SET arrived_at = updated_at "
                    "WHERE status IN ('arrived', 'called')"
                )
            )

    if service == "maintenance":
        if "service_request_numbers" not in tables:
            op.create_table(
                "service_request_numbers",
                sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
                sa.Column("issued_at", sa.DateTime(timezone=True), nullable=False),
            )

        pending_records: list[tuple[object, str, str]] = []
        for table_name in ("work_orders", "hygiene_requests"):
            if table_name not in tables:
                continue
            columns = {
                column["name"] for column in inspect(bind).get_columns(table_name)
            }
            if "service_number_id" not in columns:
                op.add_column(
                    table_name,
                    sa.Column("service_number_id", sa.Integer(), nullable=True),
                )
            table = sa.Table(table_name, sa.MetaData(), autoload_with=bind)
            pending_records.extend(
                (created_at, table_name, str(record_id))
                for record_id, created_at, number_id in bind.execute(
                    sa.select(table.c.id, table.c.created_at, table.c.service_number_id)
                ).all()
                if number_id is None
            )

        sequence_table = sa.Table(
            "service_request_numbers", sa.MetaData(), autoload_with=bind
        )
        for issued_at, table_name, record_id in sorted(
            pending_records,
            key=lambda item: (
                item[0].isoformat() if hasattr(item[0], "isoformat") else str(item[0]),
                item[1],
                item[2],
            ),
        ):
            result = bind.execute(
                sequence_table.insert().values(issued_at=issued_at)
            )
            number_id = result.inserted_primary_key[0]
            if number_id > 9_999_999:
                raise RuntimeError("Há mais de 9.999.999 solicitações de serviço")
            table = sa.Table(table_name, sa.MetaData(), autoload_with=bind)
            bind.execute(
                table.update()
                .where(table.c.id == record_id)
                .values(service_number_id=number_id)
            )

        for table_name in ("work_orders", "hygiene_requests"):
            if table_name not in tables:
                continue
            index_name = f"uq_{table_name}_service_number"
            existing_indexes = {
                index["name"] for index in inspect(bind).get_indexes(table_name)
            }
            if index_name not in existing_indexes:
                op.create_index(
                    index_name,
                    table_name,
                    ["service_number_id"],
                    unique=True,
                )


def downgrade() -> None:
    service = os.getenv("SCPO_SERVICE")
    bind = op.get_bind()
    inspector = inspect(bind)
    tables = set(inspector.get_table_names())

    if service == "nursing":
        for table_name, column_name in (
            ("reception_appointments", "arrived_at"),
            ("nursing_hourly_round_patients", "elopement_risk"),
            ("patients", "elopement_risk"),
        ):
            if table_name in tables and column_name in {
                column["name"]
                for column in inspect(bind).get_columns(table_name)
            }:
                op.drop_column(table_name, column_name)

    if service == "maintenance":
        for table_name in ("work_orders", "hygiene_requests"):
            if table_name not in tables:
                continue
            index_name = f"uq_{table_name}_service_number"
            if index_name in {
                index["name"] for index in inspect(bind).get_indexes(table_name)
            }:
                op.drop_index(index_name, table_name=table_name)
            if "service_number_id" in {
                column["name"]
                for column in inspect(bind).get_columns(table_name)
            }:
                op.drop_column(table_name, "service_number_id")
        if "service_request_numbers" in tables:
            op.drop_table("service_request_numbers")
