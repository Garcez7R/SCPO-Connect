"""Allow multiple nursing administration records for a dispensation."""

import os

from alembic import op
from sqlalchemy import inspect

revision = "0031_repeat_med_admin"
down_revision = "0030_vital_measurement_time"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return
    bind = op.get_bind()
    if "medication_administrations" not in inspect(bind).get_table_names():
        return

    inspector = inspect(bind)
    unique_constraints = [
        constraint
        for constraint in inspector.get_unique_constraints("medication_administrations")
        if constraint.get("column_names") == ["dispensation_id"]
    ]
    convention = {"uq": "uq_%(table_name)s_%(column_0_name)s"}
    if unique_constraints:
        with op.batch_alter_table(
            "medication_administrations",
            naming_convention=convention,
        ) as batch_op:
            for constraint in unique_constraints:
                batch_op.drop_constraint(
                    constraint["name"] or "uq_medication_administrations_dispensation_id",
                    type_="unique",
                )

    indexes = {
        index["name"]
        for index in inspect(bind).get_indexes("medication_administrations")
    }
    if "ix_medication_administrations_dispensation_id" not in indexes:
        op.create_index(
            "ix_medication_administrations_dispensation_id",
            "medication_administrations",
            ["dispensation_id"],
        )


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return
    if "medication_administrations" not in inspect(op.get_bind()).get_table_names():
        return

    indexes = {
        index["name"]
        for index in inspect(op.get_bind()).get_indexes("medication_administrations")
    }
    with op.batch_alter_table(
        "medication_administrations",
        naming_convention={"uq": "uq_%(table_name)s_%(column_0_name)s"},
    ) as batch_op:
        if "ix_medication_administrations_dispensation_id" in indexes:
            batch_op.drop_index("ix_medication_administrations_dispensation_id")
        batch_op.create_unique_constraint(
            "uq_medication_administrations_dispensation_id", ["dispensation_id"]
        )
