from collections.abc import Generator
from datetime import date

import pytest
from alembic import command
from alembic.config import Config
from scpo_services import audit
from scpo_services.common import clear_engine_cache, get_engine
from sqlalchemy import select
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
    assert page["total"] == 3
    assert page["offset"] == 1
    assert [event["source_event_id"] for event in page["events"]] == ["audit-page-2"]

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
