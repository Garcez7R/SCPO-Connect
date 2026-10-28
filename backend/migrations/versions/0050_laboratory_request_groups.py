"""Group laboratory exams into one tracked request."""

import os

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0050_laboratory_request_groups"
down_revision = "0049_behavioral_observations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "xray":
        return

    bind = op.get_bind()
    if "group_id" not in {
        column["name"] for column in inspect(bind).get_columns("exam_requests")
    }:
        op.add_column(
            "exam_requests",
            sa.Column("group_id", sa.String(length=36), nullable=True),
        )
    if "ix_exam_requests_group_id" not in {
        index["name"] for index in inspect(bind).get_indexes("exam_requests")
    }:
        op.create_index(
            "ix_exam_requests_group_id", "exam_requests", ["group_id"]
        )


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "xray":
        return

    bind = op.get_bind()
    if "ix_exam_requests_group_id" in {
        index["name"] for index in inspect(bind).get_indexes("exam_requests")
    }:
        op.drop_index("ix_exam_requests_group_id", table_name="exam_requests")
    if "group_id" in {
        column["name"] for column in inspect(bind).get_columns("exam_requests")
    }:
        op.drop_column("exam_requests", "group_id")
