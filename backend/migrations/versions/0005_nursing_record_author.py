"""Store the staff member's display name with each vital record."""

import os
import uuid

import sqlalchemy as sa
from alembic import op


revision = "0005_nursing_author"
down_revision = "0004_work_orders"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return
    op.add_column("vital_records", sa.Column("actor_name", sa.String(120), nullable=True))
    op.execute("UPDATE vital_records SET actor_name = 'Equipe de enfermagem' WHERE actor_name IS NULL")
    with op.batch_alter_table("vital_records") as batch:
        batch.alter_column("actor_name", existing_type=sa.String(120), nullable=False)
        batch.alter_column(
            "patient_reference",
            existing_type=sa.String(32),
            type_=sa.String(36),
            existing_nullable=False,
        )
    with op.batch_alter_table("patients") as batch:
        batch.alter_column(
            "reference",
            existing_type=sa.String(32),
            type_=sa.String(36),
            existing_nullable=False,
        )

    connection = op.get_bind()
    patient = connection.execute(
        sa.text("SELECT reference FROM patients WHERE reference = 'DEMO-001'")
    ).first()
    if patient:
        new_reference = str(uuid.uuid4())
        connection.execute(
            sa.text("UPDATE vital_records SET patient_reference = :new WHERE patient_reference = :old"),
            {"new": new_reference, "old": "DEMO-001"},
        )
        connection.execute(
            sa.text("UPDATE patients SET reference = :new, name = 'Paciente cadastrado anteriormente' WHERE reference = :old"),
            {"new": new_reference, "old": "DEMO-001"},
        )


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "nursing":
        return
    with op.batch_alter_table("vital_records") as batch:
        batch.drop_column("actor_name")
