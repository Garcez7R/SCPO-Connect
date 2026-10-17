import pytest
from alembic import command
from alembic.config import Config
from scpo_services.common import (
    clear_engine_cache,
    get_engine,
    verify_database_migrated,
)
from sqlalchemy import inspect, text


@pytest.mark.parametrize(
    ("service", "table"),
    [
        ("access", "demo_users"),
        ("audit", "audit_events"),
        ("nursing", "emergency_arrivals"),
        ("pharmacy", "pharmacy_stock_movements"),
        ("social", "social_referrals"),
        ("xray", "exam_requests"),
        ("maintenance", "work_orders"),
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
    with get_engine(service).connect() as connection:
        revision = connection.exec_driver_sql(
            "SELECT version_num FROM alembic_version"
        ).scalar_one()
    assert revision == "0023_patient_allergy_status"
    if service == "nursing":
        assert len(tables) == 7
        patient_columns = {
            column["name"] for column in inspect(get_engine(service)).get_columns("patients")
        }
        assert {"allergies_status", "responsible_status"} <= patient_columns
        report_columns = {column["name"] for column in inspect(get_engine(service)).get_columns("therapy_activities")}
        assert {"activity_report", "report_updated_by", "report_updated_at"} <= report_columns
        assert any(foreign_key.get("referred_table") == "patients" for foreign_key in inspect(get_engine(service)).get_foreign_keys("vital_records"))
        assert any(foreign_key.get("referred_table") == "patients" for foreign_key in inspect(get_engine(service)).get_foreign_keys("emergency_arrivals"))
    elif service == "access":
        assert len(tables) == 3
    elif service == "maintenance":
        assert len(tables) == 4
        assert "hygiene_requests" in tables
    elif service == "social":
        assert len(tables) == 4
        assert "psychology_referrals" in tables
        assert "psychology_encounters" in tables
        assert "priority" in {
            column["name"]
            for column in inspect(get_engine(service)).get_columns("psychology_referrals")
        }
    elif service == "pharmacy":
        assert len(tables) == 3
        assert "average_balance" in {column["name"] for column in inspect(get_engine(service)).get_columns("inventory_items")}
    else:
        assert len(tables) == 2
    if service in {"social", "xray"}:
        column = "patient_reference"
        details = inspect(get_engine(service)).get_columns(table)
        assert next(item for item in details if item["name"] == column)["type"].length == 36
        assert any(index["name"].endswith("patient_reference") for index in inspect(get_engine(service)).get_indexes(table))
    if service == "maintenance":
        assert "patient_reference" in {column["name"] for column in inspect(get_engine(service)).get_columns(table)}
    clear_engine_cache()


def test_deployed_psychology_revision_is_recognized(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    service = "nursing"
    monkeypatch.setenv("SCPO_SERVICE", service)
    monkeypatch.setenv(
        "SCPO_NURSING_DATABASE_URL", f"sqlite:///{tmp_path / 'nursing.sqlite3'}"
    )
    clear_engine_cache()
    config = Config("alembic.ini")

    command.upgrade(config, "0019_psychology_initial")
    with get_engine(service).begin() as connection:
        connection.exec_driver_sql(
            "UPDATE alembic_version SET version_num = '0019_psychology_initial'"
        )

    command.upgrade(config, "head")
    verify_database_migrated(service)
    clear_engine_cache()


def test_psychology_upgrade_preserves_existing_referrals(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SCPO_SERVICE", "social")
    monkeypatch.setenv(
        "SCPO_SOCIAL_DATABASE_URL", f"sqlite:///{tmp_path / 'social.sqlite3'}"
    )
    clear_engine_cache()
    config = Config("alembic.ini")
    command.upgrade(config, "0019_psychology_initial")

    with get_engine("social").begin() as connection:
        connection.execute(
            text(
                "INSERT INTO psychology_referrals "
                "(patient_reference, referral_type, status, created_at) "
                "VALUES (:reference, :type, :status, :created_at)"
            ),
            {
                "reference": "123e4567-e89b-12d3-a456-426614174000",
                "type": "Acolhimento",
                "status": "open",
                "created_at": "2026-10-17 12:00:00",
            },
        )

    command.upgrade(config, "head")
    with get_engine("social").connect() as connection:
        row = connection.execute(
            text("SELECT referral_type, priority FROM psychology_referrals")
        ).one()
    assert row == ("Acolhimento", "routine")
    verify_database_migrated("social")
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


def test_pharmacy_migration_records_existing_stock_as_legacy_baseline(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SCPO_SERVICE", "pharmacy")
    monkeypatch.setenv(
        "SCPO_PHARMACY_DATABASE_URL", f"sqlite:///{tmp_path / 'pharmacy.sqlite3'}"
    )
    clear_engine_cache()
    config = Config("alembic.ini")
    command.upgrade(config, "0021_hygiene_requests")

    with get_engine("pharmacy").begin() as connection:
        connection.execute(
            text(
                "INSERT INTO inventory_items "
                "(item_name, balance, unit, lot, expiry_date, barcode, category, "
                "active_ingredient, presentation, supplier, storage_location, "
                "minimum_balance, average_balance, created_at) "
                "VALUES ('Soro', '12,5', 'frasco', 'L-01', '2027-02-01', '', "
                "'Medicamento', '', '', '', '', '0', '0', '2026-01-01 10:00:00')"
            )
        )

    command.upgrade(config, "head")
    with get_engine("pharmacy").connect() as connection:
        row = connection.execute(
            text(
                "SELECT movement_type, quantity, balance_after, actor_name "
                "FROM pharmacy_stock_movements"
            )
        ).one()
    assert row == ("opening_balance", "12,5", "12,5", "Saldo legado (migração)")
    verify_database_migrated("pharmacy")
    clear_engine_cache()
