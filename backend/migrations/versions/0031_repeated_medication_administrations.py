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
    if "medication_administrations" not in inspect(op.get_bind()).get_table_names():
        return

    convention = {"uq": "uq_%(table_name)s_%(column_0_name)s"}
    with op.batch_alter_table(
        "medication_administrations",
        naming_convention=convention,
    ) as batch_op:
        batch_op.drop_constraint(
            "uq_medication_administrations_dispensation_id",
            type_="unique",
        )
        batch_op.create_index(
            "ix_medication_administrations_dispensation_id",
            ["dispensation_id"],
        )


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return
    if "medication_administrations" not in inspect(op.get_bind()).get_table_names():
        return

    with op.batch_alter_table("medication_administrations") as batch_op:
        batch_op.drop_index("ix_medication_administrations_dispensation_id")
        batch_op.create_unique_constraint(
            "uq_medication_administrations_dispensation_id",
            ["dispensation_id"],
        )
