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
    clear_engine_cache()
