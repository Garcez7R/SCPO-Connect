from collections.abc import Generator

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
