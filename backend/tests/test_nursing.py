from collections.abc import Generator
from datetime import date

import pytest
from alembic import command
from alembic.config import Config
from fastapi import HTTPException
from pydantic import ValidationError
from scpo_services import nursing
from scpo_services.common import DemoPrincipal, clear_engine_cache, get_engine
from sqlalchemy.orm import Session


@pytest.fixture
def nursing_db(tmp_path, monkeypatch: pytest.MonkeyPatch) -> Generator[Session, None, None]:
    monkeypatch.setenv("SCPO_SERVICE", "nursing")
    monkeypatch.setenv("SCPO_NURSING_DATABASE_URL", f"sqlite:///{tmp_path / 'nursing.sqlite3'}")
    clear_engine_cache()
    command.upgrade(Config("alembic.ini"), "head")
    with Session(get_engine("nursing")) as session:
        yield session
    clear_engine_cache()


@pytest.fixture
def nurse() -> DemoPrincipal:
    return DemoPrincipal(
        "nurse-id", "nurse", "Enfermeira de teste", "nursing",
        ["nursing", "patients"],
        {"nursing": ["consultar", "criar", "alterar"], "patients": ["consultar", "criar", "alterar"]},
    )


def create_patient(db: Session, nurse: DemoPrincipal, room: str = "3", bed: str = "B") -> dict[str, object]:
    return nursing.create_patient(
        nursing.PatientPayload(name="Paciente de teste", room=room, bed=bed), nurse, db
    )


def test_patient_identity_and_active_bed_are_unique(nursing_db: Session, nurse: DemoPrincipal) -> None:
    patient = create_patient(nursing_db, nurse)
    assert patient["name"] == "Paciente de teste"
    with pytest.raises(HTTPException, match="quarto e leito") as conflict:
        create_patient(nursing_db, nurse)
    assert conflict.value.status_code == 409


def test_emergency_arrival_can_create_central_patient_without_admission(
    nursing_db: Session, nurse: DemoPrincipal, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(nursing, "emit_audit_event", lambda *args: None)
    receptionist = DemoPrincipal(
        "reception-id", "reception", "Recepcionista", "reception",
        ["reception"], {"reception": ["consultar", "criar", "alterar"]},
    )
    arrival = nursing.create_emergency_arrival(
        nursing.EmergencyArrivalPayload(
            patient_name="Pessoa em emergência",
            new_patient=nursing.EmergencyPatientPayload(
                name="Pessoa em emergência",
                allergies="Penicilina",
                allergies_status="known",
            ),
            reason="Atendimento de emergência",
        ),
        receptionist,
        nursing_db,
    )

    patient = nursing_db.get(nursing.Patient, arrival["patient_reference"])
    assert patient is not None
    assert (patient.room, patient.bed) == ("", "")
    assert patient.active is True
    assert patient.allergies_status == "known"
    assert arrival["allergies_status"] == "known"
    assert "allergies" not in arrival

    queue = nursing.list_emergency_arrivals(receptionist, nursing_db, 25, 0, None, "")
    queued_arrival = queue["arrivals"][0]
    assert queued_arrival["allergies_status"] == "known"
    assert "allergies" not in queued_arrival

    reception_profile = nursing.serialize_patient(patient, principal=receptionist, full_profile=True)
    assert "allergies" not in reception_profile
    assert "allergies_status" not in reception_profile

    clinical_profile = nursing.serialize_patient(patient, principal=nurse, full_profile=True)
    assert clinical_profile["allergies"] == "Penicilina"
    assert clinical_profile["allergies_status"] == "known"


def test_emergency_arrival_converts_existing_patient_to_inpatient_bed(
    nursing_db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(nursing, "emit_audit_event", lambda *args: None)
    receptionist = DemoPrincipal(
        "reception-id", "reception", "Recepcionista", "reception",
        ["reception"], {"reception": ["consultar", "criar", "alterar"]},
    )
    patient = nursing.create_patient(
        nursing.PatientPayload(name="Pessoa atendida", room="", bed=""),
        receptionist,
        nursing_db,
    )
    arrival = nursing.create_emergency_arrival(
        nursing.EmergencyArrivalPayload(
            patient_reference=str(patient["reference"]),
            patient_name="Pessoa atendida",
            reason="Atendimento de emergência",
        ),
        receptionist,
        nursing_db,
    )

    admitted = nursing.admit_emergency_arrival(
        arrival["id"],
        nursing.EmergencyAdmissionPayload(room="10", bed="A"),
        receptionist,
        nursing_db,
    )
    assert admitted["arrival"]["status"] == "admitted"
    assert admitted["patient"]["room"] == "10"
    assert admitted["patient"]["bed"] == "A"
    admitted_queue = nursing.list_emergency_arrivals(
        receptionist, nursing_db, 25, 0, "admitted", ""
    )
    assert admitted_queue["total"] == 1
    assert admitted_queue["arrivals"][0]["status"] == "admitted"

    with pytest.raises(HTTPException) as already_admitted:
        nursing.admit_emergency_arrival(
            arrival["id"],
            nursing.EmergencyAdmissionPayload(room="10", bed="A"),
            receptionist,
            nursing_db,
        )
    assert already_admitted.value.status_code == 409


def test_emergency_admission_rejects_unlinked_patient_and_occupied_bed(
    nursing_db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(nursing, "emit_audit_event", lambda *args: None)
    receptionist = DemoPrincipal(
        "reception-id", "reception", "Recepcionista", "reception",
        ["reception"], {"reception": ["consultar", "criar", "alterar"]},
    )
    unlinked = nursing.create_emergency_arrival(
        nursing.EmergencyArrivalPayload(patient_name="Pessoa sem cadastro", reason="Atendimento"),
        receptionist,
        nursing_db,
    )
    with pytest.raises(HTTPException) as missing_patient:
        nursing.admit_emergency_arrival(
            unlinked["id"],
            nursing.EmergencyAdmissionPayload(room="1", bed="A"),
            receptionist,
            nursing_db,
        )
    assert missing_patient.value.status_code == 409

    nursing.create_patient(
        nursing.PatientPayload(name="Paciente internado", room="1", bed="A"),
        receptionist,
        nursing_db,
    )
    incoming = nursing.create_patient(
        nursing.PatientPayload(name="Paciente incoming", room="", bed=""),
        receptionist,
        nursing_db,
    )
    arrival = nursing.create_emergency_arrival(
        nursing.EmergencyArrivalPayload(
            patient_reference=str(incoming["reference"]),
            reason="Atendimento de emergência",
        ),
        receptionist,
        nursing_db,
    )
    with pytest.raises(HTTPException) as occupied:
        nursing.admit_emergency_arrival(
            arrival["id"],
            nursing.EmergencyAdmissionPayload(room="1", bed="A"),
            receptionist,
            nursing_db,
        )
    assert occupied.value.status_code == 409


def test_patient_allergy_status_requires_clear_details() -> None:
    with pytest.raises(ValidationError):
        nursing.PatientPayload(
            name="Paciente",
            room="1",
            bed="A",
            allergies="",
            allergies_status="known",
        )
    with pytest.raises(ValidationError):
        nursing.PatientPayload(
            name="Paciente",
            room="1",
            bed="A",
            allergies="Amendoim",
            allergies_status="none_known",
        )


def test_nutrition_can_confirm_no_known_allergies_and_clear_shared_alert(
    nursing_db: Session,
    nurse: DemoPrincipal,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(nursing, "emit_audit_event", lambda *args: None)
    patient_data = nursing.create_patient(
        nursing.PatientPayload(
            name="Paciente de teste",
            room="3",
            bed="B",
            allergies="Látex",
            allergies_status="known",
        ),
        nurse,
        nursing_db,
    )
    nutritionist = DemoPrincipal(
        "nutrition-id", "nutrition", "Nutricionista", "nutrition",
        ["nutrition"], {"nutrition": ["consultar", "criar"]},
    )

    nursing.create_nutrition_record(
        nursing.NutritionPayload(
            patient_reference=str(patient_data["reference"]),
            assessment_date=date.today(),
            allergies_status="none_known",
        ),
        nutritionist,
        nursing_db,
    )

    patient = nursing_db.get(nursing.Patient, str(patient_data["reference"]))
    assert patient is not None
    assert patient.allergies == ""
    assert patient.allergies_status == "none_known"
    history = nursing.list_patient_allergy_history(
        str(patient_data["reference"]), nutritionist, nursing_db
    )
    assert [event["new_status"] for event in history["events"]] == ["none_known", "known"]
    assert history["events"][0]["reason"] == "Confirmação durante avaliação nutricional"


def test_transfer_and_discharge_release_beds_and_preserve_audit_history(
    nursing_db: Session,
    nurse: DemoPrincipal,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(nursing, "emit_audit_event", lambda *args: None)
    patient = create_patient(nursing_db, nurse, room="3", bed="A")
    reference = str(patient["reference"])
    transfer = nursing.transfer_patient(
        reference,
        nursing.PatientTransferPayload(room="4", bed="B", reason="Mudança de setor"),
        nurse,
        nursing_db,
    )
    assert transfer["patient"]["room"] == "4"
    assert transfer["event"]["previous_room"] == "3"
    assert transfer["event"]["next_bed"] == "B"

    discharged = nursing.discharge_patient(
        reference,
        nursing.PatientDischargePayload(reason="Alta médica", summary="Orientações registradas"),
        nurse,
        nursing_db,
    )
    assert discharged["patient"]["active"] is False
    assert discharged["patient"]["room"] == ""
    replacement = create_patient(nursing_db, nurse, room="4", bed="B")
    assert replacement["reference"] != reference
    events = nursing.list_patient_flow_events(nurse, nursing_db, reference)
    assert [event["event_type"] for event in events["events"]] == ["discharge", "transfer"]

    with pytest.raises(HTTPException) as already_discharged:
        nursing.discharge_patient(
            reference,
            nursing.PatientDischargePayload(reason="Nova tentativa de alta"),
            nurse,
            nursing_db,
        )
    assert already_discharged.value.status_code == 404


def test_clinical_risks_are_resolved_with_reason_and_emergency_priority_is_auditable(
    nursing_db: Session,
    nurse: DemoPrincipal,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(nursing, "emit_audit_event", lambda *args: None)
    patient_data = create_patient(nursing_db, nurse, room="2", bed="A")
    reference = str(patient_data["reference"])
    risk = nursing.create_clinical_risk(
        reference,
        nursing.ClinicalRiskPayload(
            description="Contraindicação a contraste iodado",
            severity="high",
            reason="Registro em prontuário validado",
        ),
        nurse,
        nursing_db,
    )
    assert risk["status"] == "active"
    resolved = nursing.resolve_clinical_risk(
        int(risk["id"]),
        nursing.ClinicalRiskResolutionPayload(reason="Revisão clínica documentada"),
        nurse,
        nursing_db,
    )
    assert resolved["status"] == "resolved"
    assert resolved["resolution_reason"] == "Revisão clínica documentada"

    receptionist = DemoPrincipal(
        "reception-id",
        "reception",
        "Recepcionista",
        "reception",
        ["reception"],
        {"reception": ["consultar", "criar", "alterar"]},
    )
    arrival = nursing.create_emergency_arrival(
        nursing.EmergencyArrivalPayload(
            patient_reference=reference,
            patient_name="Paciente de teste",
            reason="Avaliação na emergência",
        ),
        receptionist,
        nursing_db,
    )
    prioritized = nursing.update_emergency_clinical_priority(
        str(arrival["id"]),
        nursing.EmergencyClinicalPriorityPayload(
            clinical_priority="urgent",
            reason="Classificação clínica presencial",
        ),
        nurse,
        nursing_db,
    )
    assert prioritized["clinical_priority"] == "urgent"
    assert prioritized["clinical_priority_updated_by"] == nurse.actor_name
    assert prioritized["clinical_priority_reason"] == "Classificação clínica presencial"


def test_management_dashboard_returns_aggregate_counts_only(
    nursing_db: Session,
    nurse: DemoPrincipal,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(nursing, "emit_audit_event", lambda *args: None)
    create_patient(nursing_db, nurse, room="1", bed="A")
    manager = DemoPrincipal(
        "manager-id",
        "manager",
        "Gestora",
        "management",
        ["management"],
        {"management": ["consultar"]},
    )
    result = nursing.get_management_dashboard(manager, nursing_db)
    assert result["active_patients"] == 1
    assert result["occupied_beds"] == 1
    assert "patient_reference" not in result


def test_vitals_require_a_measurement_and_keep_actor(nursing_db: Session, nurse: DemoPrincipal) -> None:
    patient = create_patient(nursing_db, nurse)
    reference = str(patient["reference"])
    with pytest.raises(HTTPException) as empty:
        nursing.create_vital_record(nursing.VitalPayload(patient_reference=reference, values={}), nurse, nursing_db)
    assert empty.value.status_code == 422

    record = nursing.create_vital_record(
        nursing.VitalPayload(patient_reference=reference, values={"saturation": "98", "pressure": "120/80"}),
        nurse, nursing_db,
    )
    assert record["patient_reference"] == reference
    assert record["actor_name"] == nurse.actor_name


def test_vital_structure_rejects_invalid_saturation_and_conflicting_na(nursing_db: Session, nurse: DemoPrincipal) -> None:
    patient = create_patient(nursing_db, nurse)
    reference = str(patient["reference"])
    for values, not_applicable in (({"saturation": "101"}, []), ({"saturation": "98"}, ["saturation"])):
        with pytest.raises(HTTPException) as invalid:
            nursing.create_vital_record(
                nursing.VitalPayload(patient_reference=reference, values=values, not_applicable=not_applicable),
                nurse, nursing_db,
            )
        assert invalid.value.status_code == 422


def test_vital_elimination_and_venous_access_choices_are_restricted() -> None:
    nursing.VitalPayload(
        patient_reference="123e4567-e89b-12d3-a456-426614174000",
        values={
            "urine": "Sim",
            "bowel": "Não",
            "bowelTube": "Não",
            "venousCondition": "venoso periférico",
        },
    )
    for values in ({"urine": "Talvez"}, {"bowelTube": "Não sei"}, {"venousCondition": "registrada"}, {"painScale": "1-10"}):
        with pytest.raises(ValidationError):
            nursing.VitalPayload(
                patient_reference="123e4567-e89b-12d3-a456-426614174000",
                values=values,
            )


def test_vital_filters_and_discharge_preserve_history(nursing_db: Session, nurse: DemoPrincipal) -> None:
    patient = create_patient(nursing_db, nurse)
    reference = str(patient["reference"])
    nursing.create_vital_record(
        nursing.VitalPayload(patient_reference=reference, values={"heartRate": "72"}), nurse, nursing_db
    )
    result = nursing.list_vital_records(
        nurse, nursing_db, limit=10, offset=0, patient_reference=reference,
        room="3", bed="B", from_date=None, to_date=None,
    )
    assert result["total"] == 1
    nursing.update_patient_status(reference, {"active": False}, nurse, nursing_db)
    history = nursing.list_patient_history(reference, nurse, nursing_db, limit=50, offset=0)
    assert history["total"] == 1
    archived = nursing.list_patients(nurse, nursing_db, include_inactive=True)
    assert archived["patients"][0]["active"] is False
