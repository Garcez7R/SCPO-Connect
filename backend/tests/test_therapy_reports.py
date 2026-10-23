from collections.abc import Generator

import pytest
from alembic import command
from alembic.config import Config
from scpo_services import therapy
from scpo_services.common import DemoPrincipal, clear_engine_cache, get_engine
from scpo_services.nursing import Patient
from sqlalchemy.orm import Session


@pytest.fixture
def therapy_database(tmp_path, monkeypatch: pytest.MonkeyPatch) -> Generator[Session, None, None]:
    monkeypatch.setenv("SCPO_SERVICE", "nursing")
    monkeypatch.setenv("SCPO_NURSING_DATABASE_URL", f"sqlite:///{tmp_path / 'nursing.sqlite3'}")
    clear_engine_cache()
    command.upgrade(Config("alembic.ini"), "head")
    with Session(get_engine("nursing")) as session:
        yield session
    clear_engine_cache()


def test_therapy_staff_can_save_a_report_for_management(therapy_database: Session) -> None:
    therapist = DemoPrincipal("therapist-id", "therapist", "Profissional da oficina", "therapy", ["therapy"], {"therapy": ["consultar", "criar", "alterar"]})
    manager = DemoPrincipal("manager-id", "gestor", "Gestão Hospitalar", "management", ["management"], {"management": ["consultar"]})
    created = therapy.create_activity(
        therapy.ActivityPayload(
            title="Oficina de pintura",
            activity_type="arte",
            description="Atividade em grupo",
            location="Sala de atividades",
            starts_at="2026-10-14T14:00:00-03:00",
        ),
        therapist,
        therapy_database,
    )
    updated = therapy.update_activity_report(
        created["id"],
        therapy.ActivityReportPayload(
            activity_report="Seis participantes concluíram a atividade.",
            status="completed",
        ),
        therapist,
        therapy_database,
    )
    report = therapy.list_activities(
        manager,
        therapy_database,
        from_date=None,
        to_date=None,
        limit=200,
    )
    assert updated["activity_report"] == "Seis participantes concluíram a atividade."
    assert updated["status"] == "completed"
    assert updated["report_updated_by"] == "Profissional da oficina"
    assert report["activities"][0]["activity_report"] == "Seis participantes concluíram a atividade."
    assert report["total"] == 1


def test_therapy_reports_support_offset_pagination(
    therapy_database: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(therapy, "emit_audit_event", lambda *args, **kwargs: None)
    therapist = DemoPrincipal(
        "therapist-id", "therapist", "Profissional da oficina",
        "therapy", ["therapy"], {"therapy": ["consultar", "criar"]},
    )
    for day in (14, 15):
        therapy.create_activity(
            therapy.ActivityPayload(
                title=f"Atividade {day}",
                activity_type="arte",
                location="Sala de atividades",
                starts_at=f"2026-10-{day:02d}T14:00:00-03:00",
            ),
            therapist,
            therapy_database,
        )

    page = therapy.list_activities(
        therapist,
        therapy_database,
        from_date=None,
        to_date=None,
        limit=1,
        offset=1,
    )

    assert page["total"] == 2
    assert page["offset"] == 1
    assert [activity["title"] for activity in page["activities"]] == ["Atividade 15"]


def test_therapy_activity_tracks_and_reconciles_participant_attendance(
    therapy_database: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(therapy, "emit_audit_event", lambda *args, **kwargs: None)
    therapist = DemoPrincipal(
        "therapist-id", "therapist", "Profissional da oficina",
        "therapy", ["therapy"], {"therapy": ["consultar", "criar", "alterar"]},
    )
    patients = [
        Patient(reference=f"patient-{index}", name=f"Paciente {index}", room=f"room-{index}", bed="1")
        for index in (1, 2)
    ]
    therapy_database.add_all(patients)
    therapy_database.commit()

    created = therapy.create_activity(
        therapy.ActivityPayload(
            title="Oficina de pintura",
            activity_type="arte",
            location="Sala de atividades",
            starts_at="2026-10-14T14:00:00-03:00",
            patient_reference="patient-1",
            participant_references=["patient-1", "patient-2"],
        ),
        therapist,
        therapy_database,
    )
    assert {item["patient_reference"] for item in created["participants"]} == {"patient-1", "patient-2"}

    updated = therapy.update_activity_participants(
        created["id"],
        therapy.ActivityParticipantsPayload(
            participants=[
                therapy.ActivityParticipantPayload(
                    patient_reference="patient-2", attendance="attended"
                )
            ]
        ),
        therapist,
        therapy_database,
    )
    assert updated["participants"] == [
        {"patient_reference": "patient-2", "attendance": "attended"}
    ]
    assert therapy.list_activities(
        therapist, therapy_database, from_date=None, to_date=None, limit=100
    )["activities"][0]["participants"] == updated["participants"]


def test_therapy_roster_returns_only_operational_identity(
    therapy_database: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(therapy, "emit_audit_event", lambda *args, **kwargs: None)
    therapist = DemoPrincipal(
        "therapist-id", "therapist", "Profissional da oficina",
        "therapy", ["therapy"], {"therapy": ["consultar"]},
    )
    patient = Patient(
        reference="patient-private",
        name="Paciente Oficina",
        room="Quarto reservado",
        bed="Leito reservado",
        birth_date=therapy.datetime(1980, 1, 2).date(),
        allergies="Alergia confidencial",
        allergies_status="known",
    )
    therapy_database.add(patient)
    therapy_database.commit()

    roster = therapy.list_therapy_participants(therapist, therapy_database)

    assert roster["participants"] == [
        {"reference": "patient-private", "name": "Paciente Oficina", "birth_date": "1980-01-02"}
    ]
