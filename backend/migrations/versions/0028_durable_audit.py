"""Add transactional domain outboxes and append-only audit hash chaining."""

import hashlib
import json
import os
import uuid
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect, text

revision = "0028_durable_audit"
down_revision = "0027_bed_capacity"
branch_labels = None
depends_on = None

OUTBOX_SERVICES = {"access", "nursing", "pharmacy", "social", "xray", "maintenance"}
GENESIS_HASH = "0" * 64


def _timestamp_string(value: datetime | str) -> str:
    stamp = value if isinstance(value, datetime) else datetime.fromisoformat(str(value))
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=UTC)
    else:
        stamp = stamp.astimezone(UTC)
    return stamp.isoformat()


def _event_hash(
    source_event_id: str,
    actor_name: str,
    actor_role: str,
    action: str,
    module: str,
    target_id: str,
    happened_at: str,
    previous_hash: str,
) -> str:
    payload = {
        "source_event_id": source_event_id,
        "actor_name": actor_name,
        "actor_role": actor_role,
        "action": action,
        "module": module,
        "target_id": target_id,
        "happened_at": happened_at,
        "previous_hash": previous_hash,
    }
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def upgrade() -> None:
    service = os.getenv("SCPO_SERVICE")
    bind = op.get_bind()
    tables = set(inspect(bind).get_table_names())

    if service in OUTBOX_SERVICES:
        if "audit_outbox" not in tables:
            op.create_table(
                "audit_outbox",
                sa.Column("id", sa.String(36), primary_key=True),
                sa.Column("actor_name", sa.String(100), nullable=False),
                sa.Column("actor_role", sa.String(40), nullable=False),
                sa.Column("action", sa.String(60), nullable=False),
                sa.Column("module", sa.String(40), nullable=False),
                sa.Column("target_id", sa.String(40), nullable=False),
                sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
                sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
                sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=False),
                sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
                sa.Column("last_error", sa.String(500), nullable=False, server_default=""),
            )
            op.create_index(
                "ix_audit_outbox_pending",
                "audit_outbox",
                ["delivered_at", "next_attempt_at"],
            )
        return

    if service != "audit":
        return

    columns = {column["name"] for column in inspect(bind).get_columns("audit_events")}
    for name, column_type in (
        ("source_event_id", sa.String(36)),
        ("previous_hash", sa.String(64)),
        ("event_hash", sa.String(64)),
    ):
        if name not in columns:
            op.add_column("audit_events", sa.Column(name, column_type, nullable=True))

    previous_hash = GENESIS_HASH
    rows = bind.execute(
        text(
            "SELECT id, actor_name, actor_role, action, module, target_id, happened_at "
            "FROM audit_events ORDER BY id"
        )
    ).mappings()
    for row in rows:
        source_event_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"scpo-audit-existing-{row['id']}"))
        happened_at = _timestamp_string(row["happened_at"])
        event_hash = _event_hash(
            source_event_id,
            row["actor_name"],
            row["actor_role"],
            row["action"],
            row["module"],
            row["target_id"],
            happened_at,
            previous_hash,
        )
        bind.execute(
            text(
                "UPDATE audit_events SET source_event_id=:source_event_id, "
                "previous_hash=:previous_hash, event_hash=:event_hash WHERE id=:id"
            ),
            {
                "source_event_id": source_event_id,
                "previous_hash": previous_hash,
                "event_hash": event_hash,
                "id": row["id"],
            },
        )
        previous_hash = event_hash

    with op.batch_alter_table("audit_events") as batch:
        batch.alter_column("source_event_id", existing_type=sa.String(36), nullable=False)
        batch.alter_column("previous_hash", existing_type=sa.String(64), nullable=False)
        batch.alter_column("event_hash", existing_type=sa.String(64), nullable=False)

    indexes = {index["name"] for index in inspect(bind).get_indexes("audit_events")}
    if "uq_audit_events_source_event_id" not in indexes:
        op.create_index(
            "uq_audit_events_source_event_id",
            "audit_events",
            ["source_event_id"],
            unique=True,
        )

    if "audit_chain_heads" not in tables:
        op.create_table(
            "audit_chain_heads",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("last_hash", sa.String(64), nullable=False),
        )
        bind.execute(
            text("INSERT INTO audit_chain_heads (id, last_hash) VALUES (1, :last_hash)"),
            {"last_hash": previous_hash},
        )

    dialect = bind.dialect.name
    if dialect == "sqlite":
        op.execute(
            "CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events "
            "BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END"
        )
        op.execute(
            "CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events "
            "BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END"
        )
    elif dialect == "postgresql":
        op.execute(
            "CREATE OR REPLACE FUNCTION scpo_reject_audit_event_mutation() "
            "RETURNS trigger LANGUAGE plpgsql AS $$ "
            "BEGIN RAISE EXCEPTION 'audit_events is append-only'; END; $$"
        )
        op.execute(
            "CREATE TRIGGER audit_events_no_update_or_delete "
            "BEFORE UPDATE OR DELETE ON audit_events "
            "FOR EACH ROW EXECUTE FUNCTION scpo_reject_audit_event_mutation()"
        )


def downgrade() -> None:
    service = os.getenv("SCPO_SERVICE")
    bind = op.get_bind()
    if service in OUTBOX_SERVICES:
        op.drop_index("ix_audit_outbox_pending", table_name="audit_outbox")
        op.drop_table("audit_outbox")
        return
    if service != "audit":
        return

    if bind.dialect.name == "sqlite":
        op.execute("DROP TRIGGER IF EXISTS audit_events_no_update")
        op.execute("DROP TRIGGER IF EXISTS audit_events_no_delete")
    elif bind.dialect.name == "postgresql":
        op.execute("DROP TRIGGER IF EXISTS audit_events_no_update_or_delete ON audit_events")
        op.execute("DROP FUNCTION IF EXISTS scpo_reject_audit_event_mutation()")
    op.drop_table("audit_chain_heads")
    op.drop_index("uq_audit_events_source_event_id", table_name="audit_events")
    with op.batch_alter_table("audit_events") as batch:
        batch.drop_column("event_hash")
        batch.drop_column("previous_hash")
        batch.drop_column("source_event_id")
