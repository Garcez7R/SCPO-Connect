import pytest
from alembic import command
from alembic.config import Config
from scpo_services.common import clear_engine_cache, get_engine
from sqlalchemy import inspect


@pytest.mark.parametrize(
    ("service", "table"),
    [
        ("access", "demo_users"),
        ("audit", "audit_events"),
        ("nursing", "vital_records"),
        ("pharmacy", "inventory_items"),
        ("social", "social_referrals"),
        ("xray", "exam_requests"),
    ],
)
def test_each_service_migration_creates_only_its_owned_table(
    service, table, tmp_path, monkeypatch
) -> None:
    database_url = f"sqlite:///{tmp_path / f'{service}.sqlite3'}"
    monkeypatch.setenv("SCPO_SERVICE", service)
    monkeypatch.setenv(f"SCPO_{service.upper()}_DATABASE_URL", database_url)
    clear_engine_cache()

    command.upgrade(Config("alembic.ini"), "head")

    tables = set(inspect(get_engine(service)).get_table_names())
    assert table in tables
    assert "alembic_version" in tables
    assert len(tables) == (3 if service == "nursing" else 2)
    if service == "nursing":
        report_columns = {column["name"] for column in inspect(get_engine(service)).get_columns("therapy_activities")}
        assert {"activity_report", "report_updated_by", "report_updated_at"} <= report_columns
    clear_engine_cache()


def test_therapy_migration_adds_report_fields_to_shared_nursing_database(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SCPO_SERVICE", "nursing")
    monkeypatch.setenv("SCPO_NURSING_DATABASE_URL", f"sqlite:///{tmp_path / 'nursing.sqlite3'}")
    clear_engine_cache()

    command.upgrade(Config("alembic.ini"), "head")

    inspector = inspect(get_engine("nursing"))
    report_columns = {column["name"] for column in inspector.get_columns("therapy_activities")}
    assert {"activity_report", "report_updated_by", "report_updated_at"} <= report_columns
    clear_engine_cache()
