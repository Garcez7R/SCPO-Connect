from collections.abc import Generator

import pytest
from alembic import command
from alembic.config import Config
from scpo_services import therapy
from scpo_services.common import DemoPrincipal, clear_engine_cache, get_engine
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
