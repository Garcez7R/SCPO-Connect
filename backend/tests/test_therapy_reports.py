import asyncio
from collections.abc import Generator

import pytest
from alembic import command
from alembic.config import Config
from fastapi import HTTPException
from pydantic import ValidationError
from scpo_services import therapy
from scpo_services.common import DemoPrincipal, clear_engine_cache, get_engine
from scpo_services.nursing import Patient
from sqlalchemy.orm import Session
from starlette.requests import Request


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


def test_therapy_activity_rejects_blank_required_text_fields() -> None:
    with pytest.raises(ValidationError, match="title"):
        therapy.ActivityPayload(
            title="   ",
            activity_type="arte",
            location="Sala",
            starts_at="2026-10-14T14:00:00-03:00",
        )
    with pytest.raises(ValidationError, match="location"):
        therapy.ActivityPayload(
            title="Atividade válida",
            activity_type="arte",
            location="  ",
            starts_at="2026-10-14T14:00:00-03:00",
        )


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


def test_therapy_material_inventory_records_and_validates_stock_movements(
    therapy_database: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(therapy, "emit_audit_event", lambda *args, **kwargs: None)
    therapist = DemoPrincipal(
        "therapist-id", "therapist", "Profissional da oficina",
        "therapy", ["therapy"], {"therapy": ["consultar", "criar", "alterar"]},
    )
    material = therapy.create_therapy_material(
        therapy.TherapyMaterialCreatePayload(
            name="Tinta acrílica",
            category="Pintura",
            unit="tubo",
            initial_quantity="3.5",
            color_name="Azul cobalto",
            color_code="#0047AB",
        ),
        therapist,
        therapy_database,
    )
    assert material["quantity"] == "3.500"
    assert material["color_name"] == "Azul cobalto"

    with pytest.raises(HTTPException) as error:
        therapy.create_therapy_material_movement(
            material["id"],
            therapy.TherapyMaterialAdjustmentPayload(
                direction="consumo", quantity="4", reason="Consumo para oficina"
            ),
            therapist,
            therapy_database,
        )
    assert error.value.status_code == 409

    result = therapy.create_therapy_material_movement(
        material["id"],
        therapy.TherapyMaterialAdjustmentPayload(
            direction="consumo", quantity="1.25", reason="Atividade de pintura"
        ),
        therapist,
        therapy_database,
    )
    assert result["material"]["quantity"] == "2.250"
    history = therapy.list_therapy_material_movements(
        material["id"], therapist, therapy_database
    )
    assert history["total"] == 2
    assert history["movements"][0]["balance_after"] == "2.250"
    assert history["movements"][0]["actor_name"] == "Profissional da oficina"
    older_page = therapy.list_therapy_material_movements(
        material["id"], therapist, therapy_database, limit=1, offset=1
    )
    assert len(older_page["movements"]) == 1
    assert older_page["offset"] == 1

    archived = therapy.update_therapy_material(
        material["id"],
        therapy.TherapyMaterialUpdatePayload(
            name="Tinta acrílica",
            category="Pintura",
            unit="tubo",
            color_name="Azul cobalto",
            color_code="#0047AB",
            active=False,
        ),
        therapist,
        therapy_database,
    )
    assert archived["active"] is False
    assert therapy.list_therapy_materials(therapist, therapy_database)["materials"] == []
    assert len(therapy.list_therapy_materials(therapist, therapy_database, include_archived=True)["materials"]) == 1


def test_therapy_material_image_upload_and_delete_use_configured_storage(
    therapy_database: Session, monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    monkeypatch.setattr(therapy, "emit_audit_event", lambda *args, **kwargs: None)
    monkeypatch.setattr(therapy, "therapy_materials_directory", lambda: tmp_path / "therapy-images")
    therapist = DemoPrincipal(
        "therapist-id", "therapist", "Profissional da oficina",
        "therapy", ["therapy"], {"therapy": ["consultar", "criar", "alterar"]},
    )
    folder = therapy.create_therapy_material_image_folder(
        therapy.TherapyMaterialImageFolderPayload(name="Desenhos"),
        therapist,
        therapy_database,
    )
    with pytest.raises(HTTPException) as duplicate_folder:
        therapy.create_therapy_material_image_folder(
            therapy.TherapyMaterialImageFolderPayload(name=" desenhos "),
            therapist,
            therapy_database,
        )
    assert duplicate_folder.value.status_code == 409
    image_bytes = b"\x89PNG\r\n\x1a\n" + b"test-image-content"
    request_sent = False

    async def receive():
        nonlocal request_sent
        if request_sent:
            return {"type": "http.request", "body": b"", "more_body": False}
        request_sent = True
        return {"type": "http.request", "body": image_bytes, "more_body": False}

    request = Request(
        {
            "type": "http",
            "method": "POST",
            "headers": [(b"content-type", b"image/png")],
            "path": "/api/v1/therapy/material-images",
            "query_string": b"title=Formas+para+pintar",
            "server": ("testserver", 80),
            "client": ("testclient", 50000),
            "scheme": "http",
        },
        receive,
    )
    uploaded = asyncio.run(
        therapy.upload_therapy_material_image(
            request, "Formas para pintar", therapist, therapy_database, folder["id"]
        )
    )
    image_path = tmp_path / "therapy-images" / uploaded["filename"]
    assert image_path.read_bytes() == image_bytes
    library = therapy.list_therapy_material_images(therapist, therapy_database)
    assert library["images"][0]["title"] == "Formas para pintar"
    assert library["images"][0]["folder_name"] == "Desenhos"
    assert library["folders"][0]["image_count"] == 1
    with pytest.raises(HTTPException) as nonempty_folder:
        therapy.delete_therapy_material_image_folder(folder["id"], therapist, therapy_database)
    assert nonempty_folder.value.status_code == 409
    renamed_folder = therapy.rename_therapy_material_image_folder(
        folder["id"],
        therapy.TherapyMaterialImageFolderPayload(name="Atividades"),
        therapist,
        therapy_database,
    )
    assert renamed_folder["name"] == "Atividades"
    renamed_image = therapy.update_therapy_material_image(
        uploaded["id"],
        therapy.TherapyMaterialImageUpdatePayload(title="Formas coloridas"),
        therapist,
        therapy_database,
    )
    assert renamed_image["title"] == "Formas coloridas"
    moved_image = therapy.update_therapy_material_image(
        uploaded["id"],
        therapy.TherapyMaterialImageUpdatePayload(folder_id=None),
        therapist,
        therapy_database,
    )
    assert moved_image["folder_id"] is None
    assert therapy.delete_therapy_material_image_folder(
        folder["id"], therapist, therapy_database
    ).status_code == 204
    file_response = therapy.get_therapy_material_image(
        uploaded["filename"], therapist, therapy_database
    )
    assert file_response.path == image_path
    assert file_response.headers["content-disposition"].startswith("inline;")
    response = therapy.delete_therapy_material_image(
        uploaded["id"], therapist, therapy_database
    )
    assert response.status_code == 204
    assert not image_path.exists()
    assert therapy.list_therapy_material_images(therapist, therapy_database)["images"] == []


def test_therapy_library_rejects_non_image_payloads() -> None:
    assert therapy.valid_material_image("image/png", b"\x89PNG\r\n\x1a\ncontent")
    assert not therapy.valid_material_image("image/png", b"not an image")
    assert not therapy.valid_material_image("image/svg+xml", b"<svg></svg>")


def test_therapy_material_payload_rejects_blank_names_and_negative_stock() -> None:
    with pytest.raises(ValidationError, match="name"):
        therapy.TherapyMaterialCreatePayload(
            name="  ",
            category="Pintura",
            unit="tubo",
        )
    with pytest.raises(ValidationError, match="initial_quantity"):
        therapy.TherapyMaterialCreatePayload(
            name="Tinta acrílica",
            category="Pintura",
            unit="tubo",
            initial_quantity="-1",
        )
