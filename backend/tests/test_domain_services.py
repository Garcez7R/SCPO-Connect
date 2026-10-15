from collections.abc import Generator

import pytest
from alembic import command
from alembic.config import Config
from pydantic import ValidationError
from sqlalchemy.orm import Session

from scpo_services import access, audit, nursing, pharmacy, social, xray
from scpo_services.common import DemoPrincipal, clear_engine_cache, get_engine


@pytest.fixture
def domain_database(tmp_path, monkeypatch: pytest.MonkeyPatch) -> Generator[dict[str, Session], None, None]:
    services = ("access", "audit", "nursing", "pharmacy", "social", "xray")
    for service in services:
        monkeypatch.setenv("SCPO_SERVICE", service)
        monkeypatch.setenv(f"SCPO_{service.upper()}_DATABASE_URL", f"sqlite:///{tmp_path / f'{service}.sqlite3'}")
        clear_engine_cache()
        command.upgrade(Config("alembic.ini"), "head")
    sessions = {service: Session(get_engine(service)) for service in services}
    yield sessions
    for session in sessions.values():
        session.close()
    clear_engine_cache()


def test_master_profile_resolves_all_server_modules() -> None:
    user = access._new_user("master", "Admin Master", ["management"], access._all_permissions())
    response = access._user_response(user)
    assert response["role"] == "management"
    assert set(response["modules"]) == access.MODULES
    assert set(response["permissions"]) == access.MODULES


def test_audit_accepts_minimum_clinical_access_event_without_payload() -> None:
    event = audit.AuditEventPayload(
        actor_name="Enfermeira", actor_role="nursing", action="vitals_recorded",
        module="nursing", target_id="patient-uuid",
    )
    assert event.action == "vitals_recorded"
    with pytest.raises(ValidationError):
        audit.AuditEventPayload(
            actor_name="Enfermeira", actor_role="nursing", action="vitals_recorded",
            module="nursing", target_id="patient-uuid", clinical_payload="not allowed",
        )


def test_pharmacy_records_stock_and_author(monkeypatch: pytest.MonkeyPatch, domain_database: dict[str, Session]) -> None:
    monkeypatch.setattr(pharmacy, "emit_audit_event", lambda *args: None)
    pharmacist = DemoPrincipal("pharm-1", "pharm", "Farmacêutica", "pharmacy", ["pharmacy"], {"pharmacy": ["consultar", "criar"]})
    item = pharmacy.create_item(
        pharmacy.InventoryPayload(item_name="Soro", balance="12", unit="unidade", lot="L-01", expiry_date="2027-02-01"),
        pharmacist, domain_database["pharmacy"],
    )
    assert item["balance"] == "12"
    assert item["average_balance"] == "0"
    updated = pharmacy.update_stock_thresholds(
        item["id"],
        pharmacy.StockThresholdPayload(minimum_balance="4", average_balance="10"),
        pharmacist,
        domain_database["pharmacy"],
    )
    assert updated["minimum_balance"] == "4"
    assert updated["average_balance"] == "10"
    listed = pharmacy.list_items(pharmacist, domain_database["pharmacy"])
    assert listed["items"][0]["lot"] == "L-01"
    assert listed["items"][0]["average_balance"] == "10"


def test_radiology_and_social_accept_real_uuid_references(monkeypatch: pytest.MonkeyPatch, domain_database: dict[str, Session]) -> None:
    reference = "123e4567-e89b-12d3-a456-426614174000"
    monkeypatch.setattr(social, "verify_patient_reference", lambda value: {"reference": value})
    monkeypatch.setattr(xray, "verify_patient_reference", lambda value: {"reference": value})
    monkeypatch.setattr(social, "emit_audit_event", lambda *args: None)
    monkeypatch.setattr(xray, "emit_audit_event", lambda *args: None)
    social_user = DemoPrincipal("social-1", "social", "Assistente social", "social", ["social"], {"social": ["consultar", "criar"]})
    xray_user = DemoPrincipal("xray-1", "xray", "Técnica de radiologia", "xray", ["xray"], {"xray": ["consultar", "criar"]})
    referral = social.create_referral(social.ReferralPayload(patient_reference=reference, referral_type="Acompanhamento"), social_user, domain_database["social"])
    exam = xray.create_request(xray.ExamRequestPayload(patient_reference=reference, exam_label="Radiografia"), xray_user, domain_database["xray"])
    assert referral["patient_reference"] == reference
    assert exam["patient_reference"] == reference


def test_psychology_queue_is_persisted_separately_from_social_referrals(
    monkeypatch: pytest.MonkeyPatch, domain_database: dict[str, Session]
) -> None:
    reference = "123e4567-e89b-12d3-a456-426614174000"
    monkeypatch.setattr(social, "verify_patient_reference", lambda value: {"reference": value})
    monkeypatch.setattr(social, "emit_audit_event", lambda *args: None)
    psychologist = DemoPrincipal("psych-1", "psych", "Psicóloga", "psychology", ["psychology"], {"psychology": ["consultar", "criar"]})
    social_worker = DemoPrincipal("social-1", "social", "Assistente social", "social", ["social"], {"social": ["consultar", "criar"]})
    social.create_referral(
        social.ReferralPayload(patient_reference=reference, referral_type="Acompanhamento social"),
        social_worker,
        domain_database["social"],
    )
    referral = social.create_psychology_referral(
        social.ReferralPayload(patient_reference=reference, referral_type="Acolhimento"),
        psychologist,
        domain_database["social"],
    )
    assert referral["status"] == "open"
    assert social.list_psychology_referrals(psychologist, domain_database["social"])["referrals"][0]["id"] == referral["id"]
    assert len(social.list_referrals(social_worker, domain_database["social"])["referrals"]) == 1
