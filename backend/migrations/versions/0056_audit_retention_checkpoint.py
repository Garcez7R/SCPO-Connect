"""Add verifiable checkpoints for audit event retention."""

import os

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect, text

revision = "0056_audit_retention_checkpoint"
down_revision = "0055_therapy_image_folders"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "audit":
        return

    bind = op.get_bind()
    tables = set(inspect(bind).get_table_names())
    if "audit_chain_checkpoints" not in tables:
        op.create_table(
            "audit_chain_checkpoints",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("last_pruned_event_id", sa.Integer(), nullable=False),
            sa.Column("last_hash", sa.String(length=64), nullable=False),
            sa.Column("pruned_through", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "pruning",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            ),
        )
        bind.execute(
            text(
                "INSERT INTO audit_chain_checkpoints "
                "(id, last_pruned_event_id, last_hash, pruned_through, pruning) "
                "VALUES (1, 0, :genesis_hash, NULL, false)"
            ),
            {"genesis_hash": "0" * 64},
        )

    if bind.dialect.name == "sqlite":
        op.execute("DROP TRIGGER IF EXISTS audit_events_no_delete")
        op.execute(
            "CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events "
            "WHEN COALESCE((SELECT pruning FROM audit_chain_checkpoints "
            "WHERE id=1), 0) != 1 "
            "BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END"
        )
    elif bind.dialect.name == "postgresql":
        op.execute(
            "CREATE OR REPLACE FUNCTION scpo_reject_audit_event_mutation() "
            "RETURNS trigger LANGUAGE plpgsql AS $$ "
            "BEGIN "
            "IF TG_OP = 'DELETE' AND EXISTS ("
            "SELECT 1 FROM audit_chain_checkpoints WHERE id=1 AND pruning"
            ") THEN RETURN OLD; END IF; "
            "RAISE EXCEPTION 'audit_events is append-only'; "
            "END; $$"
        )


def downgrade() -> None:
    if os.getenv("SCPO_SERVICE") != "audit":
        return

    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        op.execute("DROP TRIGGER IF EXISTS audit_events_no_delete")
        op.execute(
            "CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events "
            "BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END"
        )
    elif bind.dialect.name == "postgresql":
        op.execute(
            "CREATE OR REPLACE FUNCTION scpo_reject_audit_event_mutation() "
            "RETURNS trigger LANGUAGE plpgsql AS $$ "
            "BEGIN RAISE EXCEPTION 'audit_events is append-only'; END; $$"
        )
    op.drop_table("audit_chain_checkpoints")
