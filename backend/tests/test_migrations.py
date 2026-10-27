import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from scpo_services import audit
from scpo_services.common import (
    DemoPrincipal,
    clear_engine_cache,
    get_engine,
    verify_database_migrated,
)
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session


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
    assert revision == "0048_reception_announce"
    if service == "nursing":
        assert len(tables) == 27
        assert {"nursing_hourly_rounds", "nursing_hourly_round_patients"} <= tables
        assert {"physician_profiles", "physician_prescriptions"} <= tables
        assert "nursing_triages" in tables
        assert "administration_times" in {
            column["name"] for column in inspect(get_engine(service)).get_columns("physician_prescriptions")
        }
        assert {
            "ix_physician_prescriptions_patient_reference",
            "ix_physician_prescriptions_status_created",
        } <= {
            index["name"]
            for index in inspect(get_engine(service)).get_indexes("physician_prescriptions")
        }
        assert "reception_appointments" in tables
        assert "reception_queue_settings" in tables
        assert "queue_type" in {
            column["name"]
            for column in inspect(get_engine(service)).get_columns("emergency_arrivals")
        }
        queue_settings_columns = {
            column["name"]
            for column in inspect(get_engine(service)).get_columns("reception_queue_settings")
        }
        assert {
            "normal_before_priority",
            "normal_calls_since_priority",
            "updated_by",
            "updated_at",
        } <= queue_settings_columns
        assert "therapy_activity_attendance" in tables
        assert "same_number" in {
            column["name"] for column in inspect(get_engine(service)).get_columns("patients")
        }
        assert "measured_at" in {
            column["name"] for column in inspect(get_engine(service)).get_columns("vital_records")
        }
        assert {"elopement_risk"} <= {
            column["name"] for column in inspect(get_engine(service)).get_columns("patients")
        }
        assert "arrived_at" in {
            column["name"] for column in inspect(get_engine(service)).get_columns("reception_appointments")
        }
        assert "ix_vital_records_patient_measured_at" in {
            index["name"] for index in inspect(get_engine(service)).get_indexes("vital_records")
        }
        patient_columns = {
            column["name"] for column in inspect(get_engine(service)).get_columns("patients")
        }
        assert {"allergies_status", "responsible_status", "treatment_track"} <= patient_columns
        bed_columns = {
            column["name"] for column in inspect(get_engine(service)).get_columns("hospital_beds")
        }
        assert "hygiene_request_id" in bed_columns
        assert "medication_administrations" in tables
        administration_indexes = {
            index["name"]: index
            for index in inspect(get_engine(service)).get_indexes("medication_administrations")
        }
        assert "ix_medication_administrations_dispensation_id" in administration_indexes
        assert not any(
            constraint["name"] == "uq_medication_administrations_dispensation_id"
            for constraint in inspect(get_engine(service)).get_unique_constraints("medication_administrations")
        )
        report_columns = {
            column["name"] for column in inspect(get_engine(service)).get_columns("therapy_activities")
        }
        assert {"activity_report", "report_updated_by", "report_updated_at"} <= report_columns
        assert any(
            foreign_key.get("referred_table") == "patients"
            for foreign_key in inspect(get_engine(service)).get_foreign_keys("vital_records")
        )
        assert any(
            foreign_key.get("referred_table") == "patients"
            for foreign_key in inspect(get_engine(service)).get_foreign_keys("emergency_arrivals")
        )
        assert {
            "patient_flow_events",
            "patient_allergy_history",
            "clinical_risks",
            "hospital_units",
            "hospital_beds",
            "bed_assignments",
            "audit_outbox",
            "patient_safety_incidents",
            "institutional_documents",
        } <= tables
        assert {
            "clinical_priority",
            "clinical_priority_updated_by",
            "clinical_priority_updated_at",
            "clinical_priority_reason",
        } <= {
            column["name"] for column in inspect(get_engine(service)).get_columns("emergency_arrivals")
        }
        assert {"allergy_report_status", "reported_allergies"} <= {
            column["name"] for column in inspect(get_engine(service)).get_columns("emergency_arrivals")
        }
    elif service == "social":
        referral_columns = {
            column["name"] for column in inspect(get_engine(service)).get_columns("social_referrals")
        }
        assert {"priority", "assignee", "follow_up_due", "next_step"} <= referral_columns
        assert len(tables) == 6
        assert "audit_outbox" in tables
        assert "psychology_referrals" in tables
        assert "psychology_encounters" in tables
        assert "interprofessional_shares" in tables
        assert "priority" in {
            column["name"]
            for column in inspect(get_engine(service)).get_columns("psychology_referrals")
        }
        share_columns = {
            column["name"]: column
            for column in inspect(get_engine(service)).get_columns("interprofessional_shares")
        }
        assert share_columns["expires_at"]["nullable"] is True
    elif service == "access":
        assert len(tables) == 4
        assert "audit_outbox" in tables
        assert "is_superuser" in {
            column["name"] for column in inspect(get_engine(service)).get_columns("app_users")
        }
    elif service == "maintenance":
        assert len(tables) == 8
        assert "audit_outbox" in tables
        assert "hygiene_requests" in tables
        hygiene_columns = {
            column["name"] for column in inspect(get_engine(service)).get_columns("hygiene_requests")
        }
        assert {"bed_id", "bed_status"} <= hygiene_columns
        assert {"equipment_assets", "preventive_maintenance_plans"} <= tables
    elif service == "pharmacy":
        assert len(tables) == 9
        assert "audit_outbox" in tables
        assert "average_balance" in {column["name"] for column in inspect(get_engine(service)).get_columns("inventory_items")}
        assert "medication_dispensations" in tables
        assert "purchase_requests" in tables
        assert {"purchase_quantity", "purchase_unit", "units_per_purchase_unit"} <= {
            column["name"] for column in inspect(get_engine(service)).get_columns("inventory_items")
        }
        assert {"product_id", "location_id"} <= {
            column["name"] for column in inspect(get_engine(service)).get_columns("inventory_items")
        }
    elif service == "xray":
        assert len(tables) == 3
        assert "audit_outbox" in tables
        exam_columns = {
            column["name"] for column in inspect(get_engine(service)).get_columns("exam_requests")
        }
        assert {"result", "result_recorded_by", "result_recorded_at", "exam_type", "observations"} <= exam_columns
    elif service == "audit":
        assert len(tables) == 3
        assert "audit_chain_heads" in tables
        assert {"source_event_id", "previous_hash", "event_hash"} <= {
            column["name"] for column in inspect(get_engine(service)).get_columns("audit_events")
        }
    else:
        assert len(tables) == 2
    if service != "nursing":
        assert "nursing_triages" not in tables
    if service in {"social", "xray"}:
        column = "patient_reference"
        details = inspect(get_engine(service)).get_columns(table)
        assert next(item for item in details if item["name"] == column)["type"].length == 36
        assert any(index["name"].endswith("patient_reference") for index in inspect(get_engine(service)).get_indexes(table))
    if service == "maintenance":
        assert "patient_reference" in {column["name"] for column in inspect(get_engine(service)).get_columns(table)}
    clear_engine_cache()


def test_repeated_administration_migration_preserves_existing_records(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SCPO_SERVICE", "nursing")
    monkeypatch.setenv(
        "SCPO_NURSING_DATABASE_URL",
        f"sqlite:///{tmp_path / 'nursing.sqlite3'}",
    )
    clear_engine_cache()
    config = Config("alembic.ini")
    command.upgrade(config, "0030_vital_measurement_time")

    with get_engine("nursing").begin() as connection:
        connection.execute(
            text(
                "INSERT INTO medication_administrations "
                "(dispensation_id, patient_reference, medication_name, dose, unit, "
                "status, reason, actor_id, actor_name, administered_at) "
                "VALUES ('dispensation-1', 'patient-1', 'Medicamento', '1', "
                "'comprimido', 'administered', '', 'nurse-1', 'Enfermeira', "
                "'2026-01-01 10:00:00')"
            )
        )

    command.upgrade(config, "head")
    with get_engine("nursing").begin() as connection:
        existing = connection.execute(
            text(
                "SELECT medication_name, dose, unit FROM medication_administrations "
                "WHERE dispensation_id = 'dispensation-1'"
            )
        ).one()
        connection.execute(
            text(
                "INSERT INTO medication_administrations "
                "(dispensation_id, patient_reference, medication_name, dose, unit, "
                "status, reason, actor_id, actor_name, administered_at) "
                "VALUES ('dispensation-1', 'patient-1', 'Medicamento', '1', "
                "'comprimido', 'administered', '', 'nurse-2', 'Enfermeira', "
                "'2026-01-01 12:00:00')"
            )
        )
        count = connection.execute(
            text(
                "SELECT count(*) FROM medication_administrations "
                "WHERE dispensation_id = 'dispensation-1'"
            )
        ).scalar_one()

    assert existing == ("Medicamento", "1", "comprimido")
    assert count == 2
    verify_database_migrated("nursing")
    clear_engine_cache()


def test_repeated_administration_migration_drops_database_named_constraint(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SCPO_SERVICE", "nursing")
    monkeypatch.setenv(
        "SCPO_NURSING_DATABASE_URL",
        f"sqlite:///{tmp_path / 'nursing-custom-constraint.sqlite3'}",
    )
    clear_engine_cache()
    config = Config("alembic.ini")
    command.upgrade(config, "0030_vital_measurement_time")

    with get_engine("nursing").begin() as connection:
        connection.execute(text("DROP TABLE medication_administrations"))
        connection.execute(
            text(
                "CREATE TABLE medication_administrations ("
                "id INTEGER PRIMARY KEY, "
                "dispensation_id VARCHAR(36) NOT NULL, "
                "CONSTRAINT medication_administrations_dispensation_id_key "
                "UNIQUE (dispensation_id))"
            )
        )

    command.upgrade(config, "0031_repeat_med_admin")

    inspector = inspect(get_engine("nursing"))
    assert not inspector.get_unique_constraints("medication_administrations")
    assert "ix_medication_administrations_dispensation_id" in {
        index["name"]
        for index in inspector.get_indexes("medication_administrations")
    }
    clear_engine_cache()


def test_revision_identifiers_fit_alembic_version_column() -> None:
    revisions = ScriptDirectory.from_config(Config("alembic.ini")).walk_revisions()

    assert all(len(revision.revision) <= 32 for revision in revisions)


def test_access_migration_marks_only_configured_username_as_superuser(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    service = "access"
    monkeypatch.setenv("SCPO_SERVICE", service)
    monkeypatch.setenv("SCPO_SUPERADMIN_USERNAME", "rgarcez")
    monkeypatch.setenv("SCPO_ACCESS_DATABASE_URL", f"sqlite:///{tmp_path / 'access.sqlite3'}")
    clear_engine_cache()
    config = Config("alembic.ini")
    command.upgrade(config, "0025_patient_flow_risk")
    with get_engine(service).begin() as connection:
        connection.execute(
            text(
                "INSERT INTO app_users "
                "(id, username, name, password_hash, modules, permissions, created_at) "
                "VALUES ('root-id', 'rgarcez', 'Mantenedor', 'hash', '[]', '{}', "
                "'2026-10-18 00:00:00'), "
                "('manager-id', 'manager', 'Gestor', 'hash', '[]', '{}', "
                "'2026-10-18 00:00:00')"
            )
        )

    command.upgrade(config, "head")
    with get_engine(service).connect() as connection:
        users = dict(
            connection.execute(
                text("SELECT username, is_superuser FROM app_users")
            ).all()
        )
    assert users == {"rgarcez": 1, "manager": 0}
    verify_database_migrated(service)
    clear_engine_cache()


def test_audit_migration_backfills_a_verifiable_hash_chain(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    service = "audit"
    monkeypatch.setenv("SCPO_SERVICE", service)
    monkeypatch.setenv("SCPO_AUDIT_DATABASE_URL", f"sqlite:///{tmp_path / 'audit.sqlite3'}")
    clear_engine_cache()
    config = Config("alembic.ini")

    command.upgrade(config, "0027_bed_capacity")
    with get_engine(service).begin() as connection:
        connection.execute(
            text(
                "INSERT INTO audit_events "
                "(actor_name, actor_role, action, module, target_id, happened_at) "
                "VALUES ('Operadora', 'nursing', 'patient_record_read', 'patients', "
                "'patient-1', '2026-01-02 03:04:05.123456')"
            )
        )

    command.upgrade(config, "head")
    with Session(get_engine(service)) as session:
        result = audit.verify_audit_integrity(
            DemoPrincipal(
                "admin",
                "admin",
                "Administradora",
                "management",
                ["management"],
                {"management": ["consultar"]},
            ),
            session,
        )
    assert result["valid"] is True
    assert result["events_checked"] == 1
    verify_database_migrated(service)
    clear_engine_cache()


@pytest.mark.parametrize(
    ("current_revision", "legacy_revision"),
    [
        ("0022_stock_emergency", "0022_stock_movements_emergency_arrivals"),
        ("0024_patient_med_results", "0024_patient_linked_medications_and_results"),
        ("0025_patient_flow_risk", "0025_patient_flow_risk_and_dashboard"),
        ("0048_reception_announce", "0048_reception_announcement_version"),
    ],
)
def test_legacy_long_revision_is_normalized_before_upgrade(
    current_revision: str,
    legacy_revision: str,
    tmp_path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = "nursing"
    monkeypatch.setenv("SCPO_SERVICE", service)
    monkeypatch.setenv(
        "SCPO_NURSING_DATABASE_URL", f"sqlite:///{tmp_path / 'nursing.sqlite3'}"
    )
    clear_engine_cache()
    config = Config("alembic.ini")

    command.upgrade(config, current_revision)
    with get_engine(service).begin() as connection:
        connection.execute(
            text("UPDATE alembic_version SET version_num = :legacy"),
            {"legacy": legacy_revision},
        )

    command.upgrade(config, "head")
    verify_database_migrated(service)
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


@pytest.mark.parametrize(
    ("service", "expected_table"),
    [
        ("social", "social_referrals"),
        ("nursing", "therapy_activity_attendance"),
    ],
)
def test_social_and_therapy_workflow_migration_downgrades_cleanly(
    service: str,
    expected_table: str,
    tmp_path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("SCPO_SERVICE", service)
    monkeypatch.setenv(
        f"SCPO_{service.upper()}_DATABASE_URL",
        f"sqlite:///{tmp_path / f'{service}.sqlite3'}",
    )
    clear_engine_cache()
    config = Config("alembic.ini")

    command.upgrade(config, "head")
    command.downgrade(config, "0038_patient_same_number")

    inspector = inspect(get_engine(service))
    if service == "social":
        assert not {"priority", "assignee", "follow_up_due", "next_step"} & {
            column["name"] for column in inspector.get_columns(expected_table)
        }
    else:
        assert expected_table not in inspector.get_table_names()
    clear_engine_cache()


@pytest.mark.parametrize(
    ("service", "created_tables"),
    [
        ("maintenance", {"equipment_assets", "preventive_maintenance_plans"}),
        ("nursing", {"patient_safety_incidents", "institutional_documents"}),
        ("pharmacy", {"purchase_requests"}),
    ],
)
def test_administrative_operations_migration_downgrades_cleanly(
    service: str,
    created_tables: set[str],
    tmp_path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("SCPO_SERVICE", service)
    monkeypatch.setenv(
        f"SCPO_{service.upper()}_DATABASE_URL",
        f"sqlite:///{tmp_path / f'{service}.sqlite3'}",
    )
    clear_engine_cache()
    config = Config("alembic.ini")

    command.upgrade(config, "head")
    command.downgrade(config, "0032_inpatient_care")

    inspector = inspect(get_engine(service))
    tables = set(inspector.get_table_names())
    assert created_tables.isdisjoint(tables)
    if service == "maintenance":
        assert "asset_id" not in {
            column["name"] for column in inspector.get_columns("work_orders")
        }
    if service == "pharmacy":
        assert {
            "purchase_quantity",
            "purchase_unit",
            "units_per_purchase_unit",
        }.isdisjoint(
            {column["name"] for column in inspector.get_columns("inventory_items")}
        )
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
                "VALUES ('Soro', '12,5', 'frasco', 'L-01', '2027-02-01', "
                "'7891106000956', 'Medicamento', 'dexametasona', 'creme 1%', "
                "'Fornecedor', 'Farmácia · prateleira A', '0', '0', '2026-01-01 10:00:00')"
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
    with get_engine("pharmacy").connect() as connection:
        product = connection.execute(
            text(
                "SELECT p.gtin, p.name, p.active_ingredient, p.presentation, p.unit, "
                "l.name FROM inventory_items i "
                "JOIN pharmacy_products p ON p.id=i.product_id "
                "JOIN pharmacy_locations l ON l.id=i.location_id WHERE i.id=1"
            )
        ).one()
        foreign_keys = inspect(get_engine("pharmacy")).get_foreign_keys("inventory_items")
        columns = {column["name"] for column in inspect(get_engine("pharmacy")).get_columns("inventory_items")}
    assert product == (
        "07891106000956",
        "Soro",
        "dexametasona",
        "creme 1%",
        "frasco",
        "Farmácia · prateleira A",
    )
    assert {"product_id", "location_id"} <= columns
    assert {"item_name", "barcode", "unit", "storage_location"}.isdisjoint(columns)
    assert {foreign_key["referred_table"] for foreign_key in foreign_keys} >= {
        "pharmacy_products",
        "pharmacy_locations",
    }
    command.downgrade(config, "0028_durable_audit")
    with get_engine("pharmacy").connect() as connection:
        legacy_item = connection.execute(
            text(
                "SELECT item_name, barcode, unit, storage_location, balance "
                "FROM inventory_items WHERE id=1"
            )
        ).one()
    assert legacy_item == (
        "Soro",
        "07891106000956",
        "frasco",
        "Farmácia · prateleira A",
        "12,5",
    )
    clear_engine_cache()
