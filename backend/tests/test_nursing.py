import uuid
from collections.abc import Generator
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import httpx
import pytest
from alembic import command
from alembic.config import Config
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError
from scpo_services import common, demo_vitals, nursing
from scpo_services.common import (
    AuditOutbox,
    DemoPrincipal,
    clear_engine_cache,
    get_engine,
)
from sqlalchemy import select
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


def create_physical_bed(
    db: Session,
    room: str,
    label: str,
    unit_name: str = "Unidade de teste",
) -> dict[str, object]:
    manager = DemoPrincipal(
        "manager-id", "manager", "Gestor de teste", "management",
        ["management"], {"management": ["consultar", "criar", "alterar"]},
    )
    unit = db.scalar(select(nursing.HospitalUnit).where(nursing.HospitalUnit.name == unit_name))
    if unit is None:
        unit = nursing.create_hospital_unit(
            nursing.HospitalUnitPayload(name=unit_name),
            manager,
            db,
        )
        unit_id = str(unit["id"])
    else:
        unit_id = unit.id
    return nursing.create_hospital_bed(
        nursing.HospitalBedPayload(unit_id=unit_id, room=room, label=label),
        manager,
        db,
    )


def test_patient_identity_and_active_bed_are_unique(nursing_db: Session, nurse: DemoPrincipal) -> None:
    patient = create_patient(nursing_db, nurse)
    assert patient["name"] == "Paciente de teste"
    with pytest.raises(HTTPException, match="quarto e leito") as conflict:
        create_patient(nursing_db, nurse)
    assert conflict.value.status_code == 409


def test_synthetic_vitals_dataset_can_be_seeded_and_removed(
    nursing_db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(demo_vitals, "emit_audit_event", lambda *args, **kwargs: None)
    generated_at = datetime(2025, 2, 1, 12, tzinfo=UTC)

    created_patients, created_records = demo_vitals.seed_demo_data(nursing_db, generated_at)
    assert (created_patients, created_records) == (7, 210)
    demo_patients = nursing_db.scalars(
        select(nursing.Patient).where(nursing.Patient.name.like("DEMO - %"))
    ).all()
    assert len(demo_patients) == 7
    demo_records = nursing_db.scalars(
        select(nursing.VitalRecord).where(
            nursing.VitalRecord.patient_reference.in_(
                [patient.reference for patient in demo_patients]
            )
        )
    ).all()
    assert len(demo_records) == 210
    assert len({record.measured_at.date() for record in demo_records}) == 30
    assert all(
        record.values["notes"].startswith("DADO SINTETICO PARA APRESENTACAO")
        for record in demo_records
    )
    first_patient_records = [
        record
        for record in demo_records
        if record.patient_reference == demo_patients[0].reference
    ]
    assert len({record.values["heartRate"] for record in first_patient_records}) > 10
    nursing_db.commit()

    with pytest.raises(RuntimeError, match="já existem"):
        demo_vitals.seed_demo_data(nursing_db, generated_at)
    nursing_db.rollback()

    dependency = nursing.PatientObservation(
        patient_reference=demo_patients[0].reference,
        attention_level="green",
        observation="Registro de teste vinculado.",
        treatment_status="completed",
        actor_id="test-user",
        actor_name="Usuário de teste",
        created_at=generated_at,
    )
    nursing_db.add(dependency)
    nursing_db.commit()
    with pytest.raises(RuntimeError, match="patient_observations"):
        demo_vitals.cleanup_demo_data(nursing_db, nursing_db.get_bind())
    nursing_db.delete(dependency)
    nursing_db.commit()

    additional_record = nursing.VitalRecord(
        patient_reference=demo_patients[0].reference,
        actor_id="clinician",
        actor_name="Profissional de teste",
        values={"notes": "Aferição registrada durante o atendimento."},
        glucose_unit="mg/dL",
        not_applicable=[],
        measured_at=generated_at,
        recorded_at=generated_at,
        voided_at=None,
        voided_by="",
        void_reason="",
    )
    nursing_db.add(additional_record)
    nursing_db.commit()
    with pytest.raises(RuntimeError, match="aferições não demonstrativas"):
        demo_vitals.cleanup_demo_data(nursing_db, nursing_db.get_bind())
    assert nursing_db.get(nursing.VitalRecord, additional_record.id) is not None
    nursing_db.delete(additional_record)
    nursing_db.commit()

    removed_patients, removed_records = demo_vitals.cleanup_demo_data(
        nursing_db, nursing_db.get_bind()
    )
    assert (removed_patients, removed_records) == (7, 210)
    assert not nursing_db.scalars(
        select(nursing.Patient).where(nursing.Patient.name.like("DEMO - %"))
    ).all()


def test_synthetic_vitals_requires_non_production_confirmation(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    with pytest.raises(RuntimeError, match="--confirm-non-production"):
        demo_vitals.require_non_production_confirmation(False)

    monkeypatch.setenv("SCPO_ENV", "development")
    demo_data_dir = tmp_path / "demo"
    monkeypatch.setenv("SCPO_DEMO_DATA_DIR", str(demo_data_dir))
    monkeypatch.setenv(
        "SCPO_NURSING_DATABASE_URL",
        f"sqlite:///{demo_data_dir / 'nursing.sqlite3'}",
    )
    demo_vitals.require_non_production_confirmation(True)

    monkeypatch.setenv("SCPO_NURSING_DATABASE_URL", "postgresql://localhost/scpo_demo")
    with pytest.raises(RuntimeError, match="somente um banco SQLite isolado"):
        demo_vitals.require_non_production_confirmation(True)

    monkeypatch.setenv(
        "SCPO_NURSING_DATABASE_URL",
        f"sqlite:///{tmp_path / 'local' / 'nursing.sqlite3'}",
    )
    with pytest.raises(RuntimeError, match="dentro de SCPO_DEMO_DATA_DIR"):
        demo_vitals.require_non_production_confirmation(True)

    monkeypatch.delenv("SCPO_NURSING_DATABASE_URL")
    with pytest.raises(RuntimeError, match="SCPO_NURSING_DATABASE_URL explicitamente"):
        demo_vitals.require_non_production_confirmation(True)

    monkeypatch.setenv("SCPO_ENV", "production")
    with pytest.raises(RuntimeError, match="bloqueada no ambiente de produção"):
        demo_vitals.require_non_production_confirmation(True)


def test_outpatient_encounter_creates_reusable_patient_and_keeps_print_snapshot(
    nursing_db: Session,
) -> None:
    receptionist = DemoPrincipal(
        "reception-id",
        "reception-user",
        "Recepcionista de teste",
        "reception",
        ["reception", "patients"],
        {"reception": ["consultar", "criar"], "patients": ["consultar", "criar"]},
    )
    payload = nursing.OutpatientEncounterPayload(
        new_patient=nursing.PatientPayload(
            name="Paciente ambulatorial",
            mother_name="Mãe de teste",
            health_plan="SUS",
            birth_date=date(1980, 5, 12),
            sex="Feminino",
            address="Rua Central",
            address_number="15",
            neighborhood="Centro",
            city="Pedro Osório",
            state="RS",
        ),
        encounter_type="first_consultation",
        same_number="SAME-2026-001",
        physician_name="Dra. Médica",
        examination="Exame de rotina",
        activity_rows=[
            nursing.ActivityProcedureRow(
                professional_activity="Consulta médica",
                procedure="Consulta ambulatorial",
            ),
            nursing.ActivityProcedureRow(
                professional_activity="Enfermagem",
                procedure="Aferição de sinais vitais",
            ),
            nursing.ActivityProcedureRow(
                professional_activity="Técnico de enfermagem",
                procedure="Orientação ao paciente",
            ),
            nursing.ActivityProcedureRow(
                professional_activity="Serviço social",
                procedure="Avaliação social",
            ),
        ],
        group_name="Saúde da mulher",
        programs=["prenatal"],
        diagnostic_hypothesis="Hipótese de teste",
        antibiotic_prescription="",
        referral="return_same_unit",
    )

    created = nursing.create_outpatient_encounter(payload, receptionist, nursing_db)

    snapshot = created["patient_snapshot"]
    assert isinstance(snapshot, dict)
    assert snapshot["name"] == "Paciente ambulatorial"
    assert snapshot["mother_name"] == "Mãe de teste"
    assert snapshot["health_plan"] == "SUS"
    assert snapshot["same_number"] == "SAME-2026-001"
    assert created["created_by"] == "Recepcionista de teste"
    assert len(created["activity_rows"]) == 4
    assert created["activity_rows"][-1] == {
        "professional_activity": "Serviço social",
        "procedure": "Avaliação social",
    }
    history = nursing.list_outpatient_encounters(
        receptionist,
        nursing_db,
        patient_reference=created["patient_reference"],
    )
    assert history["total"] == 1
    assert history["encounters"][0]["id"] == created["id"]


def test_reception_appointments_validate_conflicts_and_status_transitions(
    nursing_db: Session,
    nurse: DemoPrincipal,
) -> None:
    patient = create_patient(nursing_db, nurse)
    receptionist = DemoPrincipal(
        "reception-id",
        "reception-user",
        "Recepcionista de teste",
        "reception",
        ["reception"],
        {"reception": ["consultar", "criar", "alterar"]},
    )
    starts_at = datetime.now(UTC) + timedelta(days=2)
    payload = nursing.ReceptionAppointmentPayload(
        patient_reference=str(patient["reference"]),
        appointment_type="consultation",
        professional_name="Dra. Médica",
        location="Consultório 1",
        starts_at=starts_at,
        ends_at=starts_at + timedelta(minutes=30),
    )

    created = nursing.create_reception_appointment(payload, receptionist, nursing_db)

    assert created["patient_name"] == "Paciente de teste"
    assert created["status"] == "scheduled"
    assert created["starts_at"].endswith("+00:00")
    listed = nursing.list_reception_appointments(
        receptionist,
        nursing_db,
        from_at=starts_at - timedelta(hours=1),
        to_at=starts_at + timedelta(days=1),
        q="Paciente de teste",
    )
    assert listed["total"] == 1
    assert listed["appointments"][0]["id"] == created["id"]
    with pytest.raises(HTTPException) as conflict:
        nursing.create_reception_appointment(payload, receptionist, nursing_db)
    assert conflict.value.status_code == 409

    confirmed = nursing.update_reception_appointment_status(
        int(created["id"]),
        nursing.ReceptionAppointmentStatusPayload(status="confirmed"),
        receptionist,
        nursing_db,
    )
    assert confirmed["status"] == "confirmed"
    arrived = nursing.update_reception_appointment_status(
        int(created["id"]),
        nursing.ReceptionAppointmentStatusPayload(status="arrived"),
        receptionist,
        nursing_db,
    )
    assert arrived["status"] == "arrived"
    completed = nursing.update_reception_appointment_status(
        int(created["id"]),
        nursing.ReceptionAppointmentStatusPayload(status="completed"),
        receptionist,
        nursing_db,
    )
    assert completed["status"] == "completed"
    with pytest.raises(HTTPException) as invalid_transition:
        nursing.update_reception_appointment_status(
            int(created["id"]),
            nursing.ReceptionAppointmentStatusPayload(status="cancelled"),
            receptionist,
            nursing_db,
        )
    assert invalid_transition.value.status_code == 409


def test_reception_appointment_requires_timezone_and_valid_future_interval() -> None:
    now = datetime.now(UTC)
    with pytest.raises(ValidationError):
        nursing.ReceptionAppointmentPayload(
            patient_reference="patient",
            appointment_type="exam",
            professional_name="Profissional",
            location="Sala 1",
            starts_at=now.replace(tzinfo=None) + timedelta(days=1),
            ends_at=now + timedelta(days=1, minutes=30),
        )


def test_hygiene_linked_bed_requires_internal_release(nursing_db: Session) -> None:
    bed = create_physical_bed(nursing_db, "7", "A")
    bed_id = str(bed["id"])
    principal = DemoPrincipal(
        "hygiene-user",
        "hygiene",
        "Equipe de Higienização",
        "hygiene",
        ["hygiene"],
        {"hygiene": ["consultar", "alterar"]},
    )
    started = nursing.update_internal_hospital_bed_cleaning(
        bed_id,
        nursing.InternalHospitalBedCleaningPayload(
            action="start",
            request_id="hygiene-request-1",
            actor_id=principal.user_id,
            actor_name=principal.actor_name,
        ),
        nursing_db,
        None,
    )
    assert started["status"] == "cleaning"
    with pytest.raises(HTTPException) as direct_release:
        nursing.update_hospital_bed_status(
            bed_id,
            nursing.HospitalBedStatusPayload(status="available"),
            principal,
            nursing_db,
        )
    assert direct_release.value.status_code == 403
    manager = DemoPrincipal(
        "manager-id",
        "manager",
        "Gestor de teste",
        "management",
        ["management"],
        {"management": ["consultar", "alterar"]},
    )
    with pytest.raises(HTTPException) as premature_release:
        nursing.update_hospital_bed_status(
            bed_id,
            nursing.HospitalBedStatusPayload(status="available"),
            manager,
            nursing_db,
        )
    assert premature_release.value.status_code == 409

    released = nursing.update_internal_hospital_bed_cleaning(
        bed_id,
        nursing.InternalHospitalBedCleaningPayload(
            action="release",
            request_id="hygiene-request-1",
            actor_id=principal.user_id,
            actor_name=principal.actor_name,
        ),
        nursing_db,
        None,
    )
    assert released["status"] == "available"


def test_hygiene_cannot_start_on_an_unreconciled_legacy_patient(
    nursing_db: Session,
    nurse: DemoPrincipal,
) -> None:
    bed = create_physical_bed(nursing_db, "9", "A")
    create_patient(nursing_db, nurse, room="9", bed="A")
    with pytest.raises(HTTPException) as occupied:
        nursing.update_internal_hospital_bed_cleaning(
            str(bed["id"]),
            nursing.InternalHospitalBedCleaningPayload(
                action="start",
                request_id="hygiene-request-legacy",
                actor_id="hygiene-user",
                actor_name="Equipe de Higienização",
            ),
            nursing_db,
            None,
        )
    assert occupied.value.status_code == 409


def test_patient_creation_persists_audit_outbox_in_the_same_transaction(
    nursing_db: Session,
    nurse: DemoPrincipal,
) -> None:
    patient = create_patient(nursing_db, nurse)

    event = nursing_db.scalar(
        select(AuditOutbox).where(
            AuditOutbox.action == "patient_created",
            AuditOutbox.target_id == patient["reference"],
        )
    )
    assert event is not None
    assert event.delivered_at is None


def test_audit_outbox_routes_events_by_module_without_service_environment(
    nursing_db: Session,
    nurse: DemoPrincipal,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("SCPO_SERVICE")

    common.emit_audit_event(nurse, "patients", "patient_list_read", "patient_registry")

    event = nursing_db.scalar(
        select(AuditOutbox).where(
            AuditOutbox.action == "patient_list_read",
            AuditOutbox.target_id == "patient_registry",
        )
    )
    assert event is not None
    assert event.module == "patients"


def test_audit_outbox_retries_delivery_and_marks_success(
    nursing_db: Session,
    nurse: DemoPrincipal,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    patient = create_patient(nursing_db, nurse)
    event = nursing_db.scalar(
        select(AuditOutbox).where(
            AuditOutbox.action == "patient_created",
            AuditOutbox.target_id == patient["reference"],
        )
    )
    assert event is not None
    monkeypatch.setenv("SCPO_AUDIT_API_URL", "http://audit.test")
    monkeypatch.setenv("SCPO_SERVICE_TOKEN", "test-token")
    request = httpx.Request("POST", "http://audit.test/internal/v1/events")
    monkeypatch.setattr(
        common.httpx,
        "post",
        lambda *args, **kwargs: httpx.Response(503, request=request),
    )

    assert common.dispatch_pending_audit_events("nursing") == 0
    nursing_db.refresh(event)
    assert event.attempts == 1
    assert event.delivered_at is None

    event.next_attempt_at = datetime.now(UTC) - timedelta(seconds=1)
    nursing_db.commit()
    monkeypatch.setattr(
        common.httpx,
        "post",
        lambda *args, **kwargs: httpx.Response(201, request=request),
    )
    assert common.dispatch_pending_audit_events("nursing") == 1
    nursing_db.refresh(event)
    assert event.delivered_at is not None
    assert event.last_error == ""


def test_emergency_arrival_can_create_central_patient_without_admission(
    nursing_db: Session, nurse: DemoPrincipal, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(nursing, "emit_audit_event", lambda *args, **kwargs: None)
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
                email="pessoa@example.test",
                address_complement="Casa 2",
                responsible_name="Responsável de teste",
                responsible_status="provided",
                responsible_relationship="Familiar",
                responsible_phone="(53) 99999-0000",
                responsible_address="Rua de teste",
                responsible_address_number="25",
                responsible_city="Pedro Osório",
                responsible_state="RS",
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
    assert patient.email == "pessoa@example.test"
    assert patient.address_complement == "Casa 2"
    assert patient.responsible_name == "Responsável de teste"
    assert patient.responsible_status == "provided"
    assert patient.responsible_relationship == "Familiar"
    assert patient.responsible_phone == "(53) 99999-0000"
    assert patient.responsible_address == "Rua de teste"
    assert patient.responsible_address_number == "25"
    assert patient.responsible_city == "Pedro Osório"
    assert patient.responsible_state == "RS"
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


def test_emergency_arrival_queue_can_be_filtered_by_creation_period(
    nursing_db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(nursing, "emit_audit_event", lambda *args, **kwargs: None)
    receptionist = DemoPrincipal(
        "reception-id", "reception", "Recepcionista", "reception",
        ["reception"], {"reception": ["consultar", "criar", "alterar"]},
    )
    old_arrival = nursing.create_emergency_arrival(
        nursing.EmergencyArrivalPayload(
            patient_name="Pessoa de ontem",
            reason="Atendimento de emergência",
        ),
        receptionist,
        nursing_db,
    )
    current_arrival = nursing.create_emergency_arrival(
        nursing.EmergencyArrivalPayload(
            patient_name="Pessoa de hoje",
            reason="Atendimento de emergência",
        ),
        receptionist,
        nursing_db,
    )
    old_record = nursing_db.get(nursing.EmergencyArrival, old_arrival["id"])
    assert old_record is not None
    old_record.created_at = datetime.now(UTC) - timedelta(days=1)
    nursing_db.commit()

    now = datetime.now(UTC)
    start = datetime.combine(now.date(), datetime.min.time(), tzinfo=UTC)
    end = start + timedelta(days=1)
    queue = nursing.list_emergency_arrivals(
        receptionist,
        nursing_db,
        100,
        0,
        None,
        "",
        start,
        end,
    )

    assert [arrival["id"] for arrival in queue["arrivals"]] == [current_arrival["id"]]


def test_emergency_arrival_converts_existing_patient_to_inpatient_bed(
    nursing_db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(nursing, "emit_audit_event", lambda *args, **kwargs: None)
    receptionist = DemoPrincipal(
        "reception-id", "reception", "Recepcionista", "reception",
        ["reception"], {"reception": ["consultar", "criar", "alterar"]},
    )
    patient = nursing.create_patient(
        nursing.PatientPayload(name="Pessoa atendida", room="", bed=""),
        receptionist,
        nursing_db,
    )
    bed = create_physical_bed(nursing_db, "10", "A")
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
        nursing.EmergencyAdmissionPayload(bed_id=str(bed["id"])),
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
            nursing.EmergencyAdmissionPayload(bed_id=str(bed["id"])),
            receptionist,
            nursing_db,
        )
    assert already_admitted.value.status_code == 409


def test_emergency_admission_rejects_unlinked_patient_and_occupied_bed(
    nursing_db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(nursing, "emit_audit_event", lambda *args, **kwargs: None)
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
            nursing.EmergencyAdmissionPayload(bed_id="not-used"),
            receptionist,
            nursing_db,
        )
    assert missing_patient.value.status_code == 409

    occupied = nursing.create_patient(
        nursing.PatientPayload(name="Paciente internado", room="1", bed="A"),
        receptionist,
        nursing_db,
    )
    bed = create_physical_bed(nursing_db, "1", "A")
    nursing.reconcile_legacy_patient_bed(
        str(occupied["reference"]),
        nursing.PatientBedReconciliationPayload(bed_id=str(bed["id"])),
        DemoPrincipal(
            "manager-id", "manager", "Gestor de teste", "management",
            ["management"], {"management": ["consultar", "criar", "alterar"]},
        ),
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
            nursing.EmergencyAdmissionPayload(bed_id=str(bed["id"])),
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
    monkeypatch.setattr(nursing, "emit_audit_event", lambda *args, **kwargs: None)
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
    monkeypatch.setattr(nursing, "emit_audit_event", lambda *args, **kwargs: None)
    patient = create_patient(nursing_db, nurse, room="3", bed="A")
    source_bed = create_physical_bed(nursing_db, "3", "A")
    destination_bed = create_physical_bed(nursing_db, "4", "B")
    reference = str(patient["reference"])
    manager = DemoPrincipal(
        "manager-id", "manager", "Gestor de teste", "management",
        ["management"], {"management": ["consultar", "criar", "alterar"]},
    )
    nursing.reconcile_legacy_patient_bed(
        reference,
        nursing.PatientBedReconciliationPayload(bed_id=str(source_bed["id"])),
        manager,
        nursing_db,
    )
    transfer = nursing.transfer_patient(
        reference,
        nursing.PatientTransferPayload(bed_id=str(destination_bed["id"]), reason="Mudança de setor"),
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


def test_capacity_percent_waits_for_legacy_reconciliation(
    nursing_db: Session,
    nurse: DemoPrincipal,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(nursing, "emit_audit_event", lambda *args, **kwargs: None)
    manager = DemoPrincipal(
        "manager-id", "manager", "Gestor de teste", "management",
        ["management"], {"management": ["consultar", "criar", "alterar"]},
    )
    legacy_patient = create_patient(nursing_db, nurse, room="7", bed="C")
    bed = create_physical_bed(nursing_db, "7", "C")

    before_reconciliation = nursing.get_management_dashboard(manager, nursing_db)
    assert before_reconciliation["occupancy_percent"] is None
    assert before_reconciliation["unreconciled_legacy_patients"] == 1

    nursing.reconcile_legacy_patient_bed(
        str(legacy_patient["reference"]),
        nursing.PatientBedReconciliationPayload(bed_id=str(bed["id"])),
        manager,
        nursing_db,
    )
    after_reconciliation = nursing.get_management_dashboard(manager, nursing_db)
    assert after_reconciliation["occupancy_percent"] == 100.0
    assert after_reconciliation["mapped_occupied_beds"] == 1
    assert after_reconciliation["unreconciled_legacy_patients"] == 0

    nursing.discharge_patient(
        str(legacy_patient["reference"]),
        nursing.PatientDischargePayload(reason="Alta para liberar o leito"),
        manager,
        nursing_db,
    )
    nursing.update_hospital_bed_status(
        str(bed["id"]),
        nursing.HospitalBedStatusPayload(status="cleaning"),
        manager,
        nursing_db,
    )
    after_block = nursing.get_management_dashboard(manager, nursing_db)
    assert after_block["occupancy_percent"] is None
    assert after_block["operational_beds"] == 0


def test_new_unit_is_available_for_multiple_beds_in_the_same_room(
    nursing_db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(nursing, "emit_audit_event", lambda *args, **kwargs: None)
    manager = DemoPrincipal(
        "manager-id", "manager", "Gestor de teste", "management",
        ["management"], {"management": ["consultar", "criar", "alterar"]},
    )

    unit = nursing.create_hospital_unit(
        nursing.HospitalUnitPayload(name="Clínica médica"),
        manager,
        nursing_db,
    )
    unit_id = str(unit["id"])
    first_bed = nursing.create_hospital_bed(
        nursing.HospitalBedPayload(unit_id=unit_id, room="1", label="A"),
        manager,
        nursing_db,
    )
    second_bed = nursing.create_hospital_bed(
        nursing.HospitalBedPayload(unit_id=unit_id, room="1", label="B"),
        manager,
        nursing_db,
    )

    capacity = nursing.list_hospital_beds(manager, nursing_db)
    assert {"id": unit_id, "name": "Clínica médica"} in capacity["units"]
    assert {
        (bed["room"], bed["label"])
        for bed in capacity["beds"]
        if bed["unit_id"] == unit_id
    } == {("1", "A"), ("1", "B")}
    assert first_bed["unit_name"] == second_bed["unit_name"] == "Clínica médica"


def test_clinical_risks_are_resolved_with_reason_and_emergency_priority_is_auditable(
    nursing_db: Session,
    nurse: DemoPrincipal,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(nursing, "emit_audit_event", lambda *args, **kwargs: None)
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
    monkeypatch.setattr(nursing, "emit_audit_event", lambda *args, **kwargs: None)
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


def test_management_dashboard_reports_administrative_indicators(
    nursing_db: Session,
    nurse: DemoPrincipal,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(nursing, "emit_audit_event", lambda *args, **kwargs: None)
    manager = DemoPrincipal(
        "manager-id",
        "manager",
        "Gestora",
        "management",
        ["management"],
        {"management": ["consultar"]},
    )
    timezone = ZoneInfo("America/Sao_Paulo")
    local_today = datetime.now(timezone).date()
    local_start = datetime.combine(local_today, datetime.min.time(), tzinfo=timezone)
    appointment_start = (local_start + timedelta(hours=12)).astimezone(UTC)
    now = datetime.now(UTC)

    for index, status in enumerate(("scheduled", "confirmed", "no_show")):
        patient = create_patient(nursing_db, nurse, room=str(index + 1), bed="A")
        nursing_db.add(
            nursing.ReceptionAppointment(
                patient_reference=str(patient["reference"]),
                appointment_type="consultation",
                professional_name="Profissional de teste",
                location="Ambulatório",
                purpose="Consulta",
                starts_at=appointment_start,
                ends_at=appointment_start + timedelta(minutes=30),
                status=status,
                created_by=nurse.user_id,
                created_by_name=nurse.actor_name,
                updated_by_name=nurse.actor_name,
                created_at=now,
                updated_at=now,
            )
        )

    bed_data = create_physical_bed(nursing_db, "10", "A")
    bed = nursing_db.get(nursing.HospitalBed, str(bed_data["id"]))
    assert bed is not None
    bed.status = "cleaning"
    maintenance_bed_data = create_physical_bed(nursing_db, "11", "A")
    maintenance_bed = nursing_db.get(nursing.HospitalBed, str(maintenance_bed_data["id"]))
    assert maintenance_bed is not None
    maintenance_bed.status = "maintenance"

    for severity, status in (("critical", "investigating"), ("moderate", "closed")):
        nursing_db.add(
            nursing.PatientSafetyIncident(
                id=str(uuid.uuid4()),
                incident_type="fall",
                severity=severity,
                occurred_at=now,
                unit="Unidade de teste",
                location="Quarto 10",
                description="Ocorrência registrada para teste.",
                status=status,
                investigation="",
                corrective_action="",
                reported_by=nurse.actor_name,
                updated_by=nurse.actor_name,
                created_at=now,
                updated_at=now,
            )
        )

    nursing_db.add_all(
        [
            nursing.InstitutionalDocument(
                id=str(uuid.uuid4()),
                title="Protocolo em revisão",
                document_type="protocol",
                version="1.0",
                content="Conteúdo de teste.",
                status="in_review",
                valid_until=None,
                created_by=manager.actor_name,
                approved_by="",
                approved_at=None,
                created_at=now,
                updated_at=now,
            ),
            nursing.InstitutionalDocument(
                id=str(uuid.uuid4()),
                title="Protocolo vencido",
                document_type="protocol",
                version="1.0",
                content="Conteúdo de teste.",
                status="approved",
                valid_until=local_today - timedelta(days=1),
                created_by=manager.actor_name,
                approved_by=manager.actor_name,
                approved_at=now,
                created_at=now,
                updated_at=now,
            ),
            nursing.InstitutionalDocument(
                id=str(uuid.uuid4()),
                title="Protocolo próximo do vencimento",
                document_type="protocol",
                version="1.0",
                content="Conteúdo de teste.",
                status="approved",
                valid_until=local_today + timedelta(days=10),
                created_by=manager.actor_name,
                approved_by=manager.actor_name,
                approved_at=now,
                created_at=now,
                updated_at=now,
            ),
        ]
    )
    nursing_db.commit()

    result = nursing.get_management_dashboard(manager, nursing_db)

    assert result["appointments_today"] == 3
    assert result["appointments_pending_today"] == 2
    assert result["appointments_no_show_today"] == 1
    assert result["beds_in_cleaning"] == 1
    assert result["beds_in_maintenance"] == 1
    assert result["open_safety_incidents"] == 1
    assert result["serious_open_safety_incidents"] == 1
    assert result["documents_pending_review"] == 1
    assert result["approved_documents_expired"] == 1
    assert result["approved_documents_expiring_soon"] == 1


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


def test_vital_measurement_time_and_temperature_are_preserved(nursing_db: Session, nurse: DemoPrincipal) -> None:
    patient = create_patient(nursing_db, nurse)
    reference = str(patient["reference"])
    measured_at = datetime.now(UTC) - timedelta(minutes=10)
    record = nursing.create_vital_record(
        nursing.VitalPayload(
            patient_reference=reference,
            values={"temperature": "37.2"},
            measured_at=measured_at,
        ),
        nurse,
        nursing_db,
    )
    assert record["values"]["temperature"] == "37.2"
    assert datetime.fromisoformat(str(record["measured_at"])) == measured_at

    with pytest.raises(ValidationError):
        nursing.VitalPayload(
            patient_reference=reference,
            values={"temperature": "37.2"},
            measured_at=datetime.now(),
        )


def test_patient_vital_trends_return_full_time_ordered_period(nursing_db: Session, nurse: DemoPrincipal, monkeypatch: pytest.MonkeyPatch) -> None:
    patient = create_patient(nursing_db, nurse)
    reference = str(patient["reference"])
    monkeypatch.setattr(nursing, "emit_audit_event", lambda *args, **kwargs: None)
    now = datetime.now(UTC)
    for measured_at, temperature in (
        (now - timedelta(hours=5), "36.8"),
        (now - timedelta(minutes=5), "37.1"),
        (now - timedelta(days=2), "38.0"),
    ):
        nursing.create_vital_record(
            nursing.VitalPayload(
                patient_reference=reference,
                values={"temperature": temperature},
                measured_at=measured_at,
            ),
            nurse,
            nursing_db,
        )

    result = nursing.list_patient_vital_trends(reference, nurse, nursing_db, hours=6)
    assert result["total"] == 2
    records = result["records"]
    assert [record["values"]["temperature"] for record in records] == ["36.8", "37.1"]
    assert records[0]["measured_at"] < records[1]["measured_at"]


def test_patient_vital_trends_query_accepts_numeric_periods(
    nursing_db: Session,
    nurse: DemoPrincipal,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    patient = create_patient(nursing_db, nurse)
    reference = str(patient["reference"])
    monkeypatch.setattr(nursing, "emit_audit_event", lambda *args, **kwargs: None)
    nursing.create_vital_record(
        nursing.VitalPayload(
            patient_reference=reference,
            values={"temperature": "36.8"},
            measured_at=datetime.now(UTC) - timedelta(days=29),
        ),
        nurse,
        nursing_db,
    )
    nursing.app.dependency_overrides[nursing.get_nursing_db] = lambda: nursing_db
    nursing.app.dependency_overrides[nursing.PATIENT_HISTORY_ACCESS.dependency] = lambda: nurse
    try:
        with TestClient(nursing.app) as client:
            response = client.get(
                f"/api/v1/nursing/patients/{reference}/vital-trends",
                params={"hours": 720},
            )
        assert response.status_code == 200
        assert response.json()["hours"] == 720
        assert response.json()["total"] == 1
    finally:
        nursing.app.dependency_overrides.clear()


def test_patient_vital_trends_accepts_custom_calendar_range(
    nursing_db: Session,
    nurse: DemoPrincipal,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    patient = create_patient(nursing_db, nurse)
    reference = str(patient["reference"])
    monkeypatch.setattr(nursing, "emit_audit_event", lambda *args, **kwargs: None)
    nursing.create_vital_record(
        nursing.VitalPayload(
            patient_reference=reference,
            values={"temperature": "36.8"},
            measured_at=datetime(2025, 2, 10, 9, tzinfo=UTC),
        ),
        nurse,
        nursing_db,
    )
    nursing.app.dependency_overrides[nursing.get_nursing_db] = lambda: nursing_db
    nursing.app.dependency_overrides[nursing.PATIENT_HISTORY_ACCESS.dependency] = lambda: nurse
    try:
        with TestClient(nursing.app) as client:
            response = client.get(
                f"/api/v1/nursing/patients/{reference}/vital-trends",
                params={"from_date": "2025-02-10", "to_date": "2025-02-10"},
            )
            incomplete_range = client.get(
                f"/api/v1/nursing/patients/{reference}/vital-trends",
                params={"from_date": "2025-02-10"},
            )
            reversed_range = client.get(
                f"/api/v1/nursing/patients/{reference}/vital-trends",
                params={"from_date": "2025-02-11", "to_date": "2025-02-10"},
            )
        assert response.status_code == 200
        assert response.json()["total"] == 1
        assert response.json()["range_start"].startswith("2025-02-10T00:00:00")
        assert response.json()["range_end"].startswith("2025-02-10T23:59:59")
        assert incomplete_range.status_code == 422
        assert reversed_range.status_code == 422
    finally:
        nursing.app.dependency_overrides.clear()


def test_patient_vital_trends_accepts_custom_datetime_range(
    nursing_db: Session,
    nurse: DemoPrincipal,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    patient = create_patient(nursing_db, nurse)
    reference = str(patient["reference"])
    monkeypatch.setattr(nursing, "emit_audit_event", lambda *args, **kwargs: None)
    for measured_at, temperature in (
        (datetime(2025, 2, 10, 9, 15, tzinfo=UTC), "36.5"),
        (datetime(2025, 2, 10, 10, 15, tzinfo=UTC), "37.0"),
        (datetime(2025, 2, 10, 11, 15, tzinfo=UTC), "37.5"),
    ):
        nursing.create_vital_record(
            nursing.VitalPayload(
                patient_reference=reference,
                values={"temperature": temperature},
                measured_at=measured_at,
            ),
            nurse,
            nursing_db,
        )

    nursing.app.dependency_overrides[nursing.get_nursing_db] = lambda: nursing_db
    nursing.app.dependency_overrides[nursing.PATIENT_HISTORY_ACCESS.dependency] = lambda: nurse
    try:
        with TestClient(nursing.app) as client:
            response = client.get(
                f"/api/v1/nursing/patients/{reference}/vital-trends",
                params={
                    "from_at": "2025-02-10T10:00:00+00:00",
                    "to_at": "2025-02-10T10:30:00+00:00",
                },
            )
        assert response.status_code == 200
        assert [item["values"]["temperature"] for item in response.json()["records"]] == ["37.0"]
        assert response.json()["range_start"] == "2025-02-10T10:00:00+00:00"
        assert response.json()["range_end"] == "2025-02-10T10:30:00+00:00"
    finally:
        nursing.app.dependency_overrides.clear()


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


def test_patient_registry_supports_server_side_search_filters_and_pagination(
    nursing_db: Session, nurse: DemoPrincipal
) -> None:
    first = create_patient(nursing_db, nurse)
    second = nursing.create_patient(
        nursing.PatientPayload(
            name="Zelda Paciente",
            room="20",
            bed="B",
            cpf="529.982.247-25",
        ),
        nurse,
        nursing_db,
    )
    nursing.create_patient(
        nursing.PatientPayload(name="Aline Paciente", room="3", bed="A"),
        nurse,
        nursing_db,
    )
    nursing.update_patient_status(str(first["reference"]), {"active": False}, nurse, nursing_db)

    first_page = nursing.list_patients(
        nurse, nursing_db, include_inactive=True, limit=1, offset=0
    )
    second_page = nursing.list_patients(
        nurse, nursing_db, include_inactive=True, limit=1, offset=1
    )
    assert first_page["total"] == 3
    assert len(first_page["patients"]) == 1
    assert len(second_page["patients"]) == 1
    assert first_page["patients"][0]["reference"] != second_page["patients"][0]["reference"]

    searched = nursing.list_patients(
        nurse,
        nursing_db,
        include_inactive=True,
        full_profile=True,
        search="52998224725",
        status="all",
    )
    assert searched["total"] == 1
    assert searched["patients"][0]["reference"] == second["reference"]
    private_search = nursing.list_patients(
        nurse,
        nursing_db,
        include_inactive=True,
        search="52998224725",
        status="all",
    )
    assert private_search["total"] == 0
    assert first["reference"] != second["reference"]

    by_location = nursing.list_patients(
        nurse, nursing_db, include_inactive=True, room="3", bed="A", status="all"
    )
    assert by_location["total"] == 1
    assert by_location["patients"][0]["name"] == "Aline Paciente"
    assert by_location["active_count"] == 2
    assert by_location["inactive_count"] == 1
    assert by_location["active_assigned_count"] == 2
    assert by_location["active_unassigned_count"] == 0
    assert by_location["rooms"] == ["20", "3"]
    inactive = nursing.list_patients(
        nurse, nursing_db, include_inactive=True, status="inactive"
    )
    assert inactive["total"] == 1
    assert inactive["patients"][0]["reference"] == first["reference"]


def test_patient_registry_route_accepts_pagination_and_search_parameters(
    nursing_db: Session, nurse: DemoPrincipal, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(nursing, "emit_audit_event", lambda *args, **kwargs: None)
    create_patient(nursing_db, nurse)
    nursing.create_patient(
        nursing.PatientPayload(name="Zelda Paciente", room="20", bed="B"),
        nurse,
        nursing_db,
    )
    nursing.app.dependency_overrides[nursing.get_nursing_db] = lambda: nursing_db
    nursing.app.dependency_overrides[nursing.authorize_patient_module] = lambda: nurse
    try:
        with TestClient(nursing.app) as client:
            response = client.get(
                "/api/v1/nursing/patients",
                params={"limit": 1, "offset": 0, "search": "Zelda", "status": "all"},
            )
        assert response.status_code == 200
        assert response.json()["total"] == 1
        assert response.json()["patients"][0]["name"] == "Zelda Paciente"
    finally:
        nursing.app.dependency_overrides.clear()


def test_hourly_nursing_round_records_patient_checks_and_completion(
    nursing_db: Session, nurse: DemoPrincipal
) -> None:
    patient = create_patient(nursing_db, nurse)
    reference = str(patient["reference"])

    started = nursing.start_nursing_hourly_round(nurse, nursing_db)
    assert started["status"] == "open"
    assert len(started["patients"]) == 1
    assert started["patients"][0]["status"] == "pending"

    with pytest.raises(HTTPException) as pending_error:
        nursing.complete_nursing_hourly_round(str(started["id"]), nurse, nursing_db)
    assert pending_error.value.status_code == 409

    updated = nursing.update_nursing_hourly_round_patient(
        str(started["id"]),
        reference,
        nursing.NursingHourlyRoundPatientPayload(status="checked"),
        nurse,
        nursing_db,
    )
    assert updated["patients"][0]["status"] == "checked"
    assert updated["patients"][0]["checked_by_id"] == nurse.user_id
    assert updated["patients"][0]["checked_at"] is not None

    completed = nursing.complete_nursing_hourly_round(str(started["id"]), nurse, nursing_db)
    assert completed["status"] == "completed"
    assert completed["completed_by_id"] == nurse.user_id
    assert completed["completed_at"] is not None

    with pytest.raises(HTTPException) as update_error:
        nursing.update_nursing_hourly_round_patient(
            str(started["id"]),
            reference,
            nursing.NursingHourlyRoundPatientPayload(status="checked"),
            nurse,
            nursing_db,
        )
    assert update_error.value.status_code == 409


def test_hourly_nursing_round_requires_descriptive_exception(
    nursing_db: Session, nurse: DemoPrincipal
) -> None:
    patient = create_patient(nursing_db, nurse)
    started = nursing.start_nursing_hourly_round(nurse, nursing_db)

    with pytest.raises(ValidationError):
        nursing.NursingHourlyRoundPatientPayload(status="exception")
    with pytest.raises(ValidationError):
        nursing.NursingHourlyRoundPatientPayload(
            status="exception",
            exception_type="away",
            note="  ",
        )

    update = nursing.NursingHourlyRoundPatientPayload(
        status="exception",
        exception_type="away",
        note="  Paciente em atendimento externo  ",
    )
    assert update.note == "Paciente em atendimento externo"
    recorded = nursing.update_nursing_hourly_round_patient(
        str(started["id"]),
        str(patient["reference"]),
        update,
        nurse,
        nursing_db,
    )
    assert recorded["patients"][0]["status"] == "exception"
    assert recorded["patients"][0]["exception_type"] == "away"
    assert recorded["patients"][0]["note"] == update.note


def test_hourly_nursing_round_rejects_second_open_round(
    nursing_db: Session, nurse: DemoPrincipal
) -> None:
    create_patient(nursing_db, nurse)
    nursing.start_nursing_hourly_round(nurse, nursing_db)

    with pytest.raises(HTTPException) as conflict:
        nursing.start_nursing_hourly_round(nurse, nursing_db)
    assert conflict.value.status_code == 409
