from collections.abc import Generator
from datetime import UTC, date, datetime

import pytest
from alembic import command
from alembic.config import Config
from scpo_services import audit
from scpo_services.common import clear_engine_cache, get_engine
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session


@pytest.fixture
def audit_db(tmp_path, monkeypatch: pytest.MonkeyPatch) -> Generator[Session, None, None]:
    monkeypatch.setenv("SCPO_SERVICE", "audit")
    monkeypatch.setenv("SCPO_AUDIT_DATABASE_URL", f"sqlite:///{tmp_path / 'audit.sqlite3'}")
    monkeypatch.setenv("SCPO_SERVICE_TOKEN", "test-service-token")
    clear_engine_cache()
    command.upgrade(Config("alembic.ini"), "head")
    with Session(get_engine("audit")) as session:
        yield session
    clear_engine_cache()


def test_audit_event_is_idempotent_and_chain_integrity_detects_mutation(
    audit_db: Session,
) -> None:
    payload = audit.AuditEventPayload(
        source_event_id="event-idempotency-test",
        actor_name="Operator",
        actor_role="nursing",
        action="patient_record_read",
        module="patients",
        target_id="patient-reference",
    )

    first = audit.create_event(payload, audit_db, "test-service-token")
    repeated = audit.create_event(payload, audit_db, "test-service-token")
    assert repeated["event_hash"] == first["event_hash"]
    assert len(audit_db.scalars(select(audit.AuditEvent)).all()) == 1

    integrity = audit.verify_audit_integrity(
        audit.DemoPrincipal(
            user_id="admin",
            username="admin",
            actor_name="Administrator",
            role="management",
            modules=["management"],
            permissions={"management": ["consultar"]},
        ),
        audit_db,
    )
    assert integrity["valid"] is True

    event = audit_db.scalar(select(audit.AuditEvent))
    assert event is not None
    event.action = "tampered"
    with pytest.raises(IntegrityError, match="append-only"):
        audit_db.commit()
    audit_db.rollback()


def test_audit_event_search_date_filters_and_offset_pagination(audit_db: Session) -> None:
    principal = audit.DemoPrincipal(
        user_id="admin",
        username="admin",
        actor_name="Administrator",
        role="management",
        modules=["management"],
        permissions={"management": ["consultar"]},
    )
    for event_id, actor, module, day in (
        ("audit-page-1", "Ana", "nursing", 28),
        ("audit-page-2", "Bruno", "nursing", 29),
        ("audit-page-3", "Ana", "pharmacy", 30),
    ):
        audit.create_event(
            audit.AuditEventPayload(
                source_event_id=event_id,
                actor_name=actor,
                actor_role=module,
                action="record_read",
                module=module,
                target_id=f"target-{event_id}",
                happened_at=f"2026-10-{day:02d}T12:00:00+00:00",
            ),
            audit_db,
            "test-service-token",
        )

    page = audit.list_events(principal, audit_db, limit=1, offset=1)
    assert page["total"] == 4
    assert page["offset"] == 1
    assert [event["source_event_id"] for event in page["events"]] == ["audit-page-3"]

    filtered = audit.list_events(
        principal,
        audit_db,
        from_date=date(2026, 10, 29),
        to_date=date(2026, 10, 30),
        module="nursing",
        search="bruno",
    )
    assert filtered["total"] == 1
    assert [event["actor_name"] for event in filtered["events"]] == ["Bruno"]


def test_audit_retention_prunes_only_a_verified_expired_prefix(
    audit_db: Session,
) -> None:
    for event_id, occurred_at in (
        ("retention-old-prefix", "2024-01-01T12:00:00+00:00"),
        ("retention-recent", "2025-12-01T12:00:00+00:00"),
        ("retention-old-after-recent", "2024-02-01T12:00:00+00:00"),
    ):
        audit.create_event(
            audit.AuditEventPayload(
                source_event_id=event_id,
                actor_name="Operator",
                actor_role="nursing",
                action="patient_record_read",
                module="patients",
                target_id="synthetic-patient",
                happened_at=occurred_at,
            ),
            audit_db,
            "test-service-token",
        )

    deleted = audit.prune_expired_events(
        now=datetime(2026, 1, 1, tzinfo=UTC),
        retention_days=365,
    )

    assert deleted == 1
    remaining = audit_db.scalars(select(audit.AuditEvent).order_by(audit.AuditEvent.id)).all()
    assert [event.source_event_id for event in remaining] == [
        "retention-recent",
        "retention-old-after-recent",
    ]
    integrity = audit.verify_chain(audit_db)
    assert integrity["valid"] is True
    assert integrity["events_checked"] == 2
    assert integrity["checkpoint_event_id"] == 1


def test_audit_retention_stops_when_chain_is_invalid(audit_db: Session) -> None:
    audit.create_event(
        audit.AuditEventPayload(
            source_event_id="retention-invalid-chain",
            actor_name="Operator",
            actor_role="nursing",
            action="patient_record_read",
            module="patients",
            target_id="synthetic-patient",
            happened_at="2024-01-01T12:00:00+00:00",
        ),
        audit_db,
        "test-service-token",
    )
    event = audit_db.scalar(select(audit.AuditEvent))
    assert event is not None
    audit_db.execute(text("DROP TRIGGER audit_events_no_update"))
    audit_db.execute(
        text("UPDATE audit_events SET action='tampered' WHERE id=:event_id"),
        {"event_id": event.id},
    )
    audit_db.commit()

    with pytest.raises(RuntimeError, match="Cadeia de auditoria inválida"):
        audit.prune_expired_events(
            now=datetime(2026, 1, 1, tzinfo=UTC),
            retention_days=365,
        )


def test_audit_event_date_filter_rejects_reversed_period(audit_db: Session) -> None:
    principal = audit.DemoPrincipal(
        user_id="admin",
        username="admin",
        actor_name="Administrator",
        role="management",
        modules=["management"],
        permissions={"management": ["consultar"]},
    )
    with pytest.raises(audit.HTTPException) as error:
        audit.list_events(
            principal,
            audit_db,
            from_date=date(2026, 10, 30),
            to_date=date(2026, 10, 29),
        )
    assert error.value.status_code == 422
