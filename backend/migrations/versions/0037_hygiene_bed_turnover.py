"""Link hygiene work to physical hospital beds."""

import os

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0037_hygiene_bed_turnover"
down_revision = "0036_reception_appointments"
branch_labels = None
depends_on = None


def upgrade() -> None:
    service = os.getenv("SCPO_SERVICE")
    bind = op.get_bind()
    inspector = inspect(bind)

    if service == "nursing" and "hospital_beds" in inspector.get_table_names():
        columns = {column["name"] for column in inspector.get_columns("hospital_beds")}
        if "hygiene_request_id" not in columns:
            op.add_column(
                "hospital_beds",
                sa.Column("hygiene_request_id", sa.String(36), nullable=True),
            )
            op.create_index(
                "ix_hospital_beds_hygiene_request_id",
                "hospital_beds",
                ["hygiene_request_id"],
            )

    if service == "maintenance" and "hygiene_requests" in inspector.get_table_names():
        columns = {column["name"] for column in inspector.get_columns("hygiene_requests")}
        if "bed_id" not in columns:
            op.add_column(
                "hygiene_requests",
                sa.Column("bed_id", sa.String(36), nullable=True),
            )
            op.create_index(
                "ix_hygiene_requests_bed_id",
                "hygiene_requests",
                ["bed_id"],
            )
        if "bed_status" not in columns:
            op.add_column(
                "hygiene_requests",
                sa.Column(
                    "bed_status",
                    sa.String(16),
                    nullable=False,
                    server_default="none",
                ),
            )


def downgrade() -> None:
    service = os.getenv("SCPO_SERVICE")
    inspector = inspect(op.get_bind())
    tables = set(inspector.get_table_names())

    if service == "nursing" and "hospital_beds" in tables:
        columns = {column["name"] for column in inspector.get_columns("hospital_beds")}
        indexes = {index["name"] for index in inspector.get_indexes("hospital_beds")}
        if "ix_hospital_beds_hygiene_request_id" in indexes:
            op.drop_index(
                "ix_hospital_beds_hygiene_request_id",
                table_name="hospital_beds",
            )
        if "hygiene_request_id" in columns:
            op.drop_column("hospital_beds", "hygiene_request_id")

    if service == "maintenance" and "hygiene_requests" in tables:
        columns = {column["name"] for column in inspector.get_columns("hygiene_requests")}
        indexes = {index["name"] for index in inspector.get_indexes("hygiene_requests")}
        if "ix_hygiene_requests_bed_id" in indexes:
            op.drop_index("ix_hygiene_requests_bed_id", table_name="hygiene_requests")
        for name in ("bed_status", "bed_id"):
            if name in columns:
                op.drop_column("hygiene_requests", name)
