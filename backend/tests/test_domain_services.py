import asyncio
from collections.abc import Generator

import pytest
from alembic import command
from alembic.config import Config
from fastapi import HTTPException, Request
from pydantic import ValidationError
from scpo_services import access, audit, maintenance, nursing, pharmacy, social, xray
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
    monkeypatch.setattr(pharmacy, "verify_patient_reference", lambda reference: {"reference": reference, "name": "Paciente"})
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
    movements = pharmacy.list_stock_movements(pharmacist, domain_database["pharmacy"])
    assert movements["total"] == 1
    assert movements["movements"][0]["movement_type"] == "entry"
    assert movements["movements"][0]["actor_name"] == "Farmacêutica"

    issued = pharmacy.create_stock_movement(
        item["id"],
        pharmacy.StockMovementPayload(
            movement_type="issue", quantity="2,5", reason="Dispensação diária"
        ),
        pharmacist,
        domain_database["pharmacy"],
    )
    assert issued["quantity"] == "-2.5"
    assert issued["balance_after"] == "9.5"
    assert issued["actor_id"] == pharmacist.user_id
    assert pharmacy.list_items(pharmacist, domain_database["pharmacy"])["items"][0]["balance"] == "9.5"
    nurse = DemoPrincipal("nurse-1", "nurse", "Enfermeira", "nursing", ["nursing"], {"nursing": ["consultar", "criar"]})
    patient = nursing.create_patient(
        nursing.PatientPayload(
            name="Paciente da dispensação",
            room="7",
            bed="A",
            allergies="Dipirona",
            allergies_status="known",
        ),
        nurse,
        domain_database["nursing"],
    )
    dispensation = pharmacy.create_dispensation(
        pharmacy.MedicationDispensePayload(
            patient_reference=str(patient["reference"]),
            item_id=item["id"],
            quantity="1",
            prescription_reference="PRESC-001",
            prescriber_name="Dr. Teste",
            allergy_reviewed=True,
        ),
        pharmacist,
        domain_database["pharmacy"],
    )
    assert dispensation["patient_reference"] == patient["reference"]
    assert dispensation["prescription_reference"] == "PRESC-001"
    assert pharmacy.list_items(pharmacist, domain_database["pharmacy"])["items"][0]["balance"] == "8.5"
    assert pharmacy.list_dispensations(nurse, domain_database["pharmacy"])["dispensations"][0]["id"] == dispensation["id"]
    with pytest.raises(HTTPException) as allergy_unreviewed:
        pharmacy.create_dispensation(
            pharmacy.MedicationDispensePayload(
                patient_reference=str(patient["reference"]),
                item_id=item["id"],
                quantity="1",
                prescription_reference="PRESC-002",
                prescriber_name="Dr. Teste",
                allergy_reviewed=False,
            ),
            pharmacist,
            domain_database["pharmacy"],
        )
    assert allergy_unreviewed.value.status_code == 422
    with pytest.raises(HTTPException) as negative_balance:
        pharmacy.create_stock_movement(
            item["id"],
            pharmacy.StockMovementPayload(
                movement_type="issue", quantity="10", reason="Retirada maior que saldo"
            ),
            pharmacist,
            domain_database["pharmacy"],
        )
    assert negative_balance.value.status_code == 409


def test_nursing_records_patient_linked_dispensation_once(monkeypatch: pytest.MonkeyPatch, domain_database: dict[str, Session]) -> None:
    monkeypatch.setattr(nursing, "emit_audit_event", lambda *args: None)
    monkeypatch.setattr(
        nursing,
        "resolve_medication_dispensation",
        lambda identifier: {
            "id": identifier,
            "patient_reference": "123e4567-e89b-12d3-a456-426614174000",
            "medication_name": "Soro",
            "quantity": "2",
            "unit": "frasco",
        },
    )
    db = domain_database["nursing"]
    patient = nursing.Patient(
        reference="123e4567-e89b-12d3-a456-426614174000",
        name="Paciente Medicado",
        room="4",
        bed="B",
    )
    db.add(patient)
    db.commit()
    nurse = DemoPrincipal("nurse-2", "nurse", "Enfermeira", "nursing", ["nursing"], {"nursing": ["consultar", "criar"]})
    payload = nursing.MedicationAdministrationPayload(
        dispensation_id="dispense-123",
        patient_reference=patient.reference,
        status="held",
        reason="Paciente em jejum",
    )
    record = nursing.create_medication_administration(payload, nurse, db)
    assert record["medication_name"] == "Soro"
    assert record["status"] == "held"
    assert nursing.list_medication_administrations(nurse, db, patient.reference)["administrations"][0]["id"] == record["id"]
    with pytest.raises(HTTPException) as duplicate:
        nursing.create_medication_administration(payload, nurse, db)
    assert duplicate.value.status_code == 409


def test_reception_records_emergency_arrival_without_inpatient_bed(
    monkeypatch: pytest.MonkeyPatch, domain_database: dict[str, Session]
) -> None:
    events = []
    monkeypatch.setattr(nursing, "emit_audit_event", lambda *args: events.append(args))
    receptionist = DemoPrincipal(
        "reception-1",
        "reception",
        "Recepcionista",
        "reception",
        ["reception"],
        {"reception": ["consultar", "criar", "alterar"]},
    )
    arrival = nursing.create_emergency_arrival(
        nursing.EmergencyArrivalPayload(
            patient_name="Pessoa sem cadastro",
            arrival_mode="ambulance",
            reason="Procura por atendimento de emergência",
        ),
        receptionist,
        domain_database["nursing"],
    )
    assert arrival["status"] == "waiting"
    assert arrival["patient_reference"] is None
    assert arrival["patient_name"] == "Pessoa sem cadastro"
    assert arrival["created_by"] == "Recepcionista"
    db = domain_database["nursing"]
    db.add(
        nursing.Patient(
            reference="123e4567-e89b-12d3-a456-426614174000",
            name="Paciente já cadastrado",
            room="1",
            bed="A",
        )
    )
    db.commit()
    linked_arrival = nursing.create_emergency_arrival(
        nursing.EmergencyArrivalPayload(
            patient_reference="123e4567-e89b-12d3-a456-426614174000",
            patient_name="Nome informado alternativo",
            reason="Chegada vinculada ao cadastro existente",
        ),
        receptionist,
        db,
    )
    assert linked_arrival["patient_name"] == "Paciente já cadastrado"
    assert linked_arrival["patient_reference"] == "123e4567-e89b-12d3-a456-426614174000"

    listed = nursing.list_emergency_arrivals(
        receptionist, domain_database["nursing"], status="waiting"
    )
    assert listed["total"] == 2
    assert listed["status_counts"]["waiting"] == 2
    updated = nursing.update_emergency_arrival(
        arrival["id"],
        nursing.EmergencyArrivalStatusPayload(status="in_service"),
        receptionist,
        domain_database["nursing"],
    )
    assert updated["status"] == "in_service"
    completed = nursing.update_emergency_arrival(
        arrival["id"],
        nursing.EmergencyArrivalStatusPayload(status="completed"),
        receptionist,
        domain_database["nursing"],
    )
    assert completed["status"] == "completed"
    with pytest.raises(HTTPException) as closed_arrival:
        nursing.update_emergency_arrival(
            arrival["id"],
            nursing.EmergencyArrivalStatusPayload(status="waiting"),
            receptionist,
            domain_database["nursing"],
        )
    assert closed_arrival.value.status_code == 409
    assert all("Procura por atendimento" not in repr(event) for event in events)


def test_nutrition_history_search_and_pagination_run_in_the_api(
    monkeypatch: pytest.MonkeyPatch, domain_database: dict[str, Session]
) -> None:
    monkeypatch.setattr(nursing, "emit_audit_event", lambda *args: None)
    db = domain_database["nursing"]
    db.add(
        nursing.Patient(
            reference="123e4567-e89b-12d3-a456-426614174000",
            name="Paciente Nutrição",
            room="12",
            bed="A",
        )
    )
    db.commit()
    nutritionist = DemoPrincipal(
        "nutrition-1",
        "nutrition",
        "Nutricionista",
        "nutrition",
        ["nutrition"],
        {"nutrition": ["consultar", "criar"]},
    )
    for assessment_date, diet_type in [
        ("2026-04-01", "Dieta com baixo sódio"),
        ("2026-03-01", "Dieta geral"),
    ]:
        nursing.create_nutrition_record(
            nursing.NutritionPayload(
                patient_reference="123e4567-e89b-12d3-a456-426614174000",
                assessment_date=assessment_date,
                diet_type=diet_type,
            ),
            nutritionist,
            db,
        )

    filtered = nursing.list_nutrition_records(
        nutritionist, db, q="baixo sódio", limit=10, offset=0
    )
    assert filtered["total"] == 1
    assert filtered["records"][0]["diet_type"] == "Dieta com baixo sódio"

    page = nursing.list_nutrition_records(
        nutritionist, db, limit=1, offset=1
    )
    assert page["total"] == 2
    assert page["records"][0]["diet_type"] == "Dieta geral"


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
    assert social.update_referral(
        referral["id"],
        social.ReferralUpdatePayload(status="in_progress"),
        social_user,
        domain_database["social"],
    )["status"] == "in_progress"
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
    result_record = xray.update_request(
        exam["id"],
        xray.ExamRequestUpdate(result="Sem alterações agudas"),
        xray_user,
        domain_database["xray"],
    )
    assert result_record["result"] == "Sem alterações agudas"
    assert result_record["result_recorded_by"] == xray_user.actor_name
    assert result_record["result_recorded_at"] is not None
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
