import asyncio
from collections.abc import Generator
from contextlib import nullcontext

import pytest
from alembic import command
from alembic.config import Config
from fastapi import HTTPException, Request, Response
from pydantic import ValidationError
from scpo_services import (
    access,
    audit,
    backup,
    maintenance,
    nursing,
    pharmacy,
    social,
    xray,
)
from scpo_services.common import (
    DemoPrincipal,
    clear_engine_cache,
    get_engine,
    require_demo_role,
)
from scpo_services.security import SESSION_COOKIE, issue_session, verify_password
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
    assert response["is_superuser"] is False


def test_superadmin_is_explicit_and_reserved() -> None:
    user = access._new_user("rgarcez", "Mantenedor", ["management"], access._all_permissions())
    user.is_superuser = True
    response = access._user_response(user)
    assert response["is_superuser"] is True
    assert set(response["modules"]) == access.MODULES
    with pytest.raises(HTTPException) as error:
        access._prevent_superuser_changes(user)
    assert error.value.status_code == 403


def test_management_cannot_recover_credentials_or_change_superadmin(
    domain_database: dict[str, Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = domain_database["access"]
    monkeypatch.setenv("SCPO_SESSION_SIGNING_KEY", "a" * 43)
    manager = access._new_user("manager", "Gestor", ["management"], access._all_permissions())
    manager.mfa_enabled = True
    manager.mfa_secret_encrypted = "encrypted"
    root = access._new_user("rgarcez", "Mantenedor", ["management"], access._all_permissions())
    root.is_superuser = True
    nurse = access._new_user("nurse", "Enfermagem", ["nursing"], {"nursing": ["consultar"]})
    db.add_all([manager, root, nurse])
    db.commit()

    manager_token = issue_session(manager.id, "active", manager.session_version)
    manager_request = Request({
        "type": "http",
        "method": "GET",
        "path": "/",
        "headers": [(b"cookie", f"{SESSION_COOKIE}={manager_token}".encode())],
        "query_string": b"",
    })
    with pytest.raises(HTTPException) as error:
        access.list_system_admin_users(manager_request, db)
    assert error.value.status_code == 403
    with pytest.raises(HTTPException) as error:
        asyncio.run(
            access.update_user(
                root.id,
                access.UserUpdatePayload(name="Alteração indevida"),
                manager_request,
                db,
            )
        )
    assert error.value.status_code == 403

    async def record_audit(*_args) -> None:
        return None

    monkeypatch.setattr(access, "record_audit_event", record_audit)
    root_token = issue_session(root.id, "active", root.session_version)
    root_request = Request({
        "type": "http",
        "method": "POST",
        "path": "/",
        "headers": [(b"cookie", f"{SESSION_COOKIE}={root_token}".encode())],
        "query_string": b"",
    })
    result = asyncio.run(access.reset_all_user_credentials(root_request, Response(), db))
    assert {account["username"] for account in result["accounts"]} == {"manager", "nurse"}
    manager_result = next(account for account in result["accounts"] if account["username"] == "manager")
    db.refresh(manager)
    assert verify_password(manager_result["temporary_password"], manager.password_hash)
    assert manager.must_change_password is True
    assert manager.mfa_enabled is False
    assert manager.mfa_secret_encrypted is None
    assert manager.session_version == 2
    assert root.session_version == 1
    with pytest.raises(HTTPException) as error:
        backup._require_admin(
            DemoPrincipal("manager", "manager", "Gestor", "management", ["management"], {"management": ["administrar"]})
        )
    assert error.value.status_code == 403


def test_audit_accepts_minimum_clinical_access_event_without_payload() -> None:
    event = audit.AuditEventPayload(
        source_event_id="source-event",
        actor_name="Enfermeira", actor_role="nursing", action="vitals_recorded",
        module="nursing", target_id="patient-uuid",
    )
    assert event.action == "vitals_recorded"
    with pytest.raises(ValidationError):
        audit.AuditEventPayload(
            source_event_id="invalid-event",
            actor_name="Enfermeira", actor_role="nursing", action="vitals_recorded",
            module="nursing", target_id="patient-uuid", clinical_payload="not allowed",
        )


def test_pharmacy_records_stock_and_author(monkeypatch: pytest.MonkeyPatch, domain_database: dict[str, Session]) -> None:
    monkeypatch.setattr(pharmacy, "emit_audit_event", lambda *args, **kwargs: None)
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


def test_pharmacy_gs1_parser_validates_gtin_lot_expiry_and_serial() -> None:
    parsed = pharmacy.parse_gs1_barcode(
        "]d201095060001343521725033110LOT-42\x1d21SERIAL-9"
    )
    assert parsed == {
        "gtin": "09506000134352",
        "lot": "LOT-42",
        "expiry_date": "2025-03-31",
        "serial": "SERIAL-9",
    }
    assert pharmacy.parse_gs1_barcode("(01)04006381333931(17)270200(10)LOTE-1") == {
        "gtin": "04006381333931",
        "lot": "LOTE-1",
        "expiry_date": "2027-02-28",
        "serial": None,
    }
    assert pharmacy.parse_gs1_barcode("4006381333931")["gtin"] == "04006381333931"
    assert pharmacy.parse_gs1_barcode("036000291452")["gtin"] == "00036000291452"


@pytest.mark.parametrize(
    "barcode",
    [
        "4006381333932",
        "(01)04006381333931(17)271332(10)LOTE",
        "]d20104006381333932",
        "(01)04006381333931(10)",
    ],
)
def test_pharmacy_gs1_parser_rejects_invalid_codes(barcode: str) -> None:
    with pytest.raises(ValueError):
        pharmacy.parse_gs1_barcode(barcode)


def test_anvisa_cmed_parser_accepts_cp1252_and_deduplicates_eans() -> None:
    content = (
        "EAN 1;EAN 2;EAN 3;PRODUTO;APRESENTAÇÃO;SUBSTÂNCIA;LABORATÓRIO;REGISTRO\n"
        "4006381333931;4006381333931;4006381333932;Medicamento não controlado;Comprimido 500 mg;Substância;Laboratório;123\n"
    ).encode("cp1252")

    records = pharmacy.parse_anvisa_cmed_csv(content, pharmacy.datetime.now(pharmacy.UTC), None)

    assert len(records) == 1
    assert records[0]["gtin"] == "04006381333931"
    assert records[0]["product_name"] == "Medicamento não controlado"
    assert records[0]["registration"] == "123"


def test_anvisa_refresh_suggests_catalog_data_without_creating_stock(
    monkeypatch: pytest.MonkeyPatch,
    domain_database: dict[str, Session],
) -> None:
    monkeypatch.setattr(pharmacy, "emit_audit_event", lambda *args, **kwargs: None)
    content = (
        "EAN 1;EAN 2;EAN 3;PRODUTO;APRESENTAÇÃO;SUBSTÂNCIA;LABORATÓRIO;REGISTRO\n"
        "4006381333931;;;Medicamento de teste;Comprimido 500 mg;Substância;Fabricante;12345\n"
    ).encode()
    response = pharmacy.httpx.Response(200, content=content, headers={"Last-Modified": "Wed, 21 Oct 2015 07:28:00 GMT"})
    monkeypatch.setattr(pharmacy.httpx, "stream", lambda *args, **kwargs: nullcontext(response))
    pharmacist = DemoPrincipal("pharm-catalog", "pharm", "Farmacêutica", "pharmacy", ["pharmacy"], {"pharmacy": ["consultar", "criar"]})
    db = domain_database["pharmacy"]

    refreshed = pharmacy.refresh_anvisa_catalog(pharmacist, db)
    lookup = pharmacy.lookup_item_by_barcode(pharmacist, db, "4006381333931")

    assert refreshed["entry_count"] == 1
    assert refreshed["source_url"] == pharmacy.ANVISA_CMED_CATALOG_URL
    assert lookup["matches"] == []
    assert lookup["catalog_suggestions"] == [{
        "gtin": "04006381333931",
        "product_name": "Medicamento de teste",
        "active_ingredient": "Substância",
        "presentation": "Comprimido 500 mg",
        "manufacturer": "Fabricante",
        "registration": "12345",
    }]
    assert pharmacy.list_items(pharmacist, db)["items"] == []


def test_anvisa_refresh_rejects_oversized_stream_without_replacing_catalog(
    monkeypatch: pytest.MonkeyPatch,
    domain_database: dict[str, Session],
) -> None:
    class OversizedResponse:
        def __init__(self) -> None:
            self.status_code = 200
            self.headers: dict[str, str] = {}

        def __enter__(self):
            return self

        def __exit__(self, *_args) -> None:
            return None

        def iter_bytes(self):
            yield b"ab"
            yield b"cd"

    monkeypatch.setattr(pharmacy, "emit_audit_event", lambda *args, **kwargs: None)
    monkeypatch.setattr(pharmacy, "MAX_ANVISA_CATALOG_BYTES", 3)
    monkeypatch.setattr(pharmacy.httpx, "stream", lambda *args, **kwargs: OversizedResponse())
    pharmacist = DemoPrincipal("pharm-catalog-limit", "pharm", "Farmacêutica", "pharmacy", ["pharmacy"], {"pharmacy": ["consultar", "criar"]})
    db = domain_database["pharmacy"]

    with pytest.raises(HTTPException) as error:
        pharmacy.refresh_anvisa_catalog(pharmacist, db)

    assert error.value.status_code == 502
    assert db.query(pharmacy.AnvisaCatalogEntry).count() == 0


def test_pharmacy_gtin_lookup_returns_lots_without_changing_stock(
    monkeypatch: pytest.MonkeyPatch,
    domain_database: dict[str, Session],
) -> None:
    monkeypatch.setattr(pharmacy, "emit_audit_event", lambda *args, **kwargs: None)
    db = domain_database["pharmacy"]
    pharmacist = DemoPrincipal("pharm-lookup", "pharm", "Farmacêutica", "pharmacy", ["pharmacy"], {"pharmacy": ["consultar", "criar"]})
    for lot, expiry, balance, barcode, item_name in (
        ("LOTE-2", "2027-03-01", "8", "4006381333931", "Medicamento A"),
        ("LOTE-1", "2026-03-01", "4", "04006381333931", "Medicamento A"),
        ("LOTE-LEGADO", "2025-03-01", "2", "]d2010400638133393110LOTE-LEGADO", "Medicamento antigo"),
    ):
        pharmacy.create_item(
            pharmacy.InventoryPayload(
                item_name=item_name,
                barcode=barcode,
                balance=balance,
                unit="caixa",
                lot=lot,
                expiry_date=expiry,
            ),
            pharmacist,
            db,
        )

    result = pharmacy.lookup_item_by_barcode(
        pharmacist, db, "(01)04006381333931(17)270200(10)LOTE-NOVO"
    )
    assert result["gtin"] == "04006381333931"
    assert result["lot"] == "LOTE-NOVO"
    assert [item["lot"] for item in result["matches"]] == ["LOTE-LEGADO", "LOTE-1", "LOTE-2"]
    assert [item["balance"] for item in result["matches"]] == ["2", "4", "8"]
    pharmacy.create_item(
        pharmacy.InventoryPayload(
            item_name="Produto UPC",
            barcode="036000291452",
            balance="1",
            unit="unidade",
            lot="UPC-LOTE",
            expiry_date="2027-01-01",
        ),
        pharmacist,
        db,
    )
    upc_result = pharmacy.lookup_item_by_barcode(pharmacist, db, "00036000291452")
    assert [item["lot"] for item in upc_result["matches"]] == ["UPC-LOTE"]
    assert len(pharmacy.list_stock_movements(pharmacist, db)["movements"]) == 4

    unknown = pharmacy.lookup_item_by_barcode(pharmacist, db, "09506000134352")
    assert unknown["matches"] == []


def test_pharmacy_stock_alerts_include_reorder_and_expiry_actions(
    monkeypatch: pytest.MonkeyPatch,
    domain_database: dict[str, Session],
) -> None:
    monkeypatch.setattr(pharmacy, "emit_audit_event", lambda *args, **kwargs: None)
    pharmacist = DemoPrincipal("pharm-2", "pharm", "Farmacêutico", "pharmacy", ["pharmacy"], {"pharmacy": ["consultar", "criar"]})
    item = pharmacy.create_item(
        pharmacy.InventoryPayload(
            item_name="Material crítico",
            balance="0",
            unit="unidade",
            lot="L-CRIT",
            expiry_date="2000-01-01",
            minimum_balance="2",
            average_balance="10",
        ),
        pharmacist,
        domain_database["pharmacy"],
    )
    manager = DemoPrincipal("manager-2", "manager", "Gestor", "management", ["management"], {"management": ["consultar"]})
    alerts = pharmacy.list_stock_alerts(manager, domain_database["pharmacy"])["alerts"]
    assert len(alerts) == 1
    assert alerts[0]["item_id"] == item["id"]
    assert set(alerts[0]["alert_types"]) == {"critical_stock", "expired"}
    assert alerts[0]["suggested_replenishment"] == "10"


def test_nursing_records_patient_linked_dispensation_once(monkeypatch: pytest.MonkeyPatch, domain_database: dict[str, Session]) -> None:
    monkeypatch.setattr(nursing, "emit_audit_event", lambda *args, **kwargs: None)
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
    monkeypatch.setattr(nursing, "emit_audit_event", lambda *args, **kwargs: events.append(args))
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
    monkeypatch.setattr(nursing, "emit_audit_event", lambda *args, **kwargs: None)
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
    monkeypatch.setattr(social, "emit_audit_event", lambda *args, **kwargs: None)
    monkeypatch.setattr(xray, "emit_audit_event", lambda *args, **kwargs: None)
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
    monkeypatch.setattr(social, "emit_audit_event", lambda *args, **kwargs: audit_events.append(args))
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
    monkeypatch.setattr(maintenance, "emit_audit_event", lambda *args, **kwargs: None)
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
