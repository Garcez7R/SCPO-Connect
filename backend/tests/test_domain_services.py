import asyncio
from collections.abc import Generator

import pytest
from alembic import command
from alembic.config import Config
from fastapi import HTTPException, Request
from pydantic import ValidationError
from scpo_services import access, audit, maintenance, pharmacy, social, xray
from scpo_services.common import (
    DemoPrincipal,
    clear_engine_cache,
    get_engine,
    require_demo_role,
)
from sqlalchemy.orm import Session


@pytest.fixture
def domain_database(tmp_path, monkeypatch: pytest.MonkeyPatch) -> Generator[dict[str, Session], None, None]:
    services = ("access", "audit", "maintenance", "nursing", "pharmacy", "social", "xray")
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
    xray_user = DemoPrincipal("xray-1", "xray", "Técnica de radiologia", "xray", ["xray"], {"xray": ["consultar", "criar", "alterar"]})
    referral = social.create_referral(social.ReferralPayload(patient_reference=reference, referral_type="Acompanhamento"), social_user, domain_database["social"])
    exam = xray.create_request(xray.ExamRequestPayload(patient_reference=reference, exam_label="Radiografia"), xray_user, domain_database["xray"])
    assert referral["patient_reference"] == reference
    assert exam["patient_reference"] == reference
    assert exam["status"] == "requested"

    scheduled = xray.update_request(
        exam["id"],
        xray.ExamRequestUpdate(status="scheduled"),
        xray_user,
        domain_database["xray"],
    )
    assert scheduled["status"] == "scheduled"
    completed = xray.update_request(
        exam["id"],
        xray.ExamRequestUpdate(status="completed"),
        xray_user,
        domain_database["xray"],
    )
    assert completed["status"] == "completed"
    with pytest.raises(HTTPException) as closed_request:
        xray.update_request(
            exam["id"],
            xray.ExamRequestUpdate(status="scheduled"),
            xray_user,
            domain_database["xray"],
        )
    assert closed_request.value.status_code == 409


def test_psychology_queue_is_persisted_separately_from_social_referrals(
    monkeypatch: pytest.MonkeyPatch, domain_database: dict[str, Session]
) -> None:
    reference = "123e4567-e89b-12d3-a456-426614174000"
    audit_events = []
    monkeypatch.setattr(social, "verify_patient_reference", lambda value: {"reference": value})
    monkeypatch.setattr(social, "emit_audit_event", lambda *args: audit_events.append(args))
    psychologist = DemoPrincipal("psych-1", "psych", "Psicóloga", "psychology", ["psychology"], {"psychology": ["consultar", "criar"]})
    social_worker = DemoPrincipal("social-1", "social", "Assistente social", "social", ["social"], {"social": ["consultar", "criar"]})
    social.create_referral(
        social.ReferralPayload(patient_reference=reference, referral_type="Acompanhamento social"),
        social_worker,
        domain_database["social"],
    )
    referral = social.create_psychology_referral(
        social.PsychologyReferralPayload(
            patient_reference=reference,
            referral_type="Acolhimento",
            priority="priority",
        ),
        psychologist,
        domain_database["social"],
    )
    assert referral["status"] == "open"
    assert referral["priority"] == "priority"
    assert social.list_psychology_referrals(psychologist, domain_database["social"])["referrals"][0]["id"] == referral["id"]
    assert len(social.list_referrals(social_worker, domain_database["social"])["referrals"]) == 1

    updated = social.update_psychology_referral(
        referral["id"],
        social.PsychologyReferralUpdatePayload(status="scheduled"),
        psychologist,
        domain_database["social"],
    )
    assert updated["status"] == "scheduled"

    encounter = social.create_psychology_encounter(
        social.PsychologyEncounterPayload(
            patient_reference=reference,
            encounter_type="intake",
            objective="  Acolhimento inicial  ",
            evolution="  Registro clínico confidencial  ",
            plan="  Acompanhamento  ",
        ),
        psychologist,
        domain_database["social"],
    )
    assert encounter["objective"] == "Acolhimento inicial"
    assert encounter["evolution"] == "Registro clínico confidencial"
    assert encounter["actor_name"] == "Psicóloga"
    assert social.list_psychology_encounters(
        psychologist, domain_database["social"], patient_reference=reference
    )["encounters"][0]["id"] == encounter["id"]
    assert all("Registro clínico confidencial" not in repr(event) for event in audit_events)


def test_psychology_encounters_require_structured_content() -> None:
    with pytest.raises(ValidationError):
        social.PsychologyEncounterPayload(
            patient_reference="123e4567-e89b-12d3-a456-426614174000",
            encounter_type="intake",
            objective="  ",
            evolution="",
        )
    with pytest.raises(ValidationError):
        social.PsychologyEncounterPayload(
            patient_reference="123e4567-e89b-12d3-a456-426614174000",
            encounter_type="unknown",
            objective="Acolhimento",
            evolution="Registro",
        )


def test_psychology_routes_require_module_permission(monkeypatch: pytest.MonkeyPatch) -> None:
    principal = DemoPrincipal(
        "psych-1",
        "psych",
        "Psicóloga",
        "psychology",
        ["psychology"],
        {"psychology": ["consultar", "criar", "alterar"]},
    )

    async def resolve_principal(_request: Request) -> DemoPrincipal:
        return principal

    monkeypatch.setattr("scpo_services.common.authenticated_principal", resolve_principal)
    authorize = require_demo_role("psychology")
    request = Request({"type": "http", "method": "GET", "headers": [], "path": "/"})
    assert asyncio.run(authorize(request)) == principal

    principal = DemoPrincipal(
        "social-1",
        "social",
        "Assistente social",
        "social",
        ["social"],
        {"social": ["consultar"]},
    )
    with pytest.raises(HTTPException) as denied:
        asyncio.run(authorize(request))
    assert denied.value.status_code == 403


def test_hygiene_requests_have_a_dedicated_assignable_queue(
    monkeypatch: pytest.MonkeyPatch, domain_database: dict[str, Session]
) -> None:
    monkeypatch.setattr(maintenance, "emit_audit_event", lambda *args: None)
    hygiene_worker = DemoPrincipal(
        "hygiene-1",
        "hygiene",
        "Equipe de Higienização",
        "hygiene",
        ["hygiene"],
        {"hygiene": ["consultar", "criar", "alterar"]},
    )
    request = maintenance.create_hygiene_request(
        maintenance.HygieneRequestCreate(
            request_type="spot",
            unit=" Hospital ",
            area="room",
            location=" Quarto 3 ",
            description=" Limpeza pontual solicitada ",
            priority="high",
        ),
        hygiene_worker,
        domain_database["maintenance"],
    )
    assert request["unit"] == "Hospital"
    assert request["location"] == "Quarto 3"
    assert request["status"] == "open"
    assert request["requester_name"] == "Equipe de Higienização"

    updated = maintenance.update_hygiene_request(
        request["id"],
        maintenance.HygieneRequestUpdate(
            status="in_progress",
            assignee=" Profissional 1 ",
        ),
        hygiene_worker,
        domain_database["maintenance"],
    )
    assert updated["status"] == "in_progress"
    assert updated["assignee"] == "Profissional 1"
    assert maintenance.list_hygiene_requests(
        hygiene_worker, domain_database["maintenance"]
    )["requests"][0]["id"] == request["id"]


def test_hygiene_custom_request_requires_a_description() -> None:
    with pytest.raises(ValidationError):
        maintenance.HygieneRequestCreate(
            request_type="other",
            custom_type=None,
            unit="Hospital",
            area="other",
            location="Corredor",
        )


@pytest.mark.parametrize("service_type", ["Higienização", "higienizacao"])
def test_hygiene_is_not_created_as_a_maintenance_order(service_type: str) -> None:
    with pytest.raises(ValidationError, match="fila própria"):
        maintenance.WorkOrderCreate(
            title="Solicitação de limpeza",
            description="Limpeza de área comum",
            service_type=service_type,
            department="Enfermagem",
        )
