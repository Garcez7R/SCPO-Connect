from collections.abc import Generator
from contextlib import ExitStack

import pytest
from fastapi.testclient import TestClient
from scpo_services import access, audit, nursing, pharmacy, social, xray
from scpo_services.common import clear_engine_cache


@pytest.fixture
def clients(tmp_path, monkeypatch) -> Generator[dict[str, TestClient], None, None]:
    for service in ("access", "audit", "pharmacy", "social", "xray"):
        monkeypatch.setenv(
            f"SCPO_{service.upper()}_DATABASE_URL",
            f"sqlite:///{tmp_path / f'{service}.sqlite3'}",
        )
    monkeypatch.setenv("SCPO_SERVICE_TOKEN", "test-service-token")
    clear_engine_cache()
    apps = {
        "access": access.app,
        "audit": audit.app,
        "nursing": nursing.app,
        "pharmacy": pharmacy.app,
        "social": social.app,
        "xray": xray.app,
    }
    with ExitStack() as stack:
        yield {
            name: stack.enter_context(TestClient(service_app))
            for name, service_app in apps.items()
        }
    clear_engine_cache()


def test_access_service_limits_user_administration_to_admin(
    clients: dict[str, TestClient],
) -> None:
    users = clients["access"].get(
        "/api/v1/access/users", headers={"X-Demo-Role": "admin"}
    )
    denied = clients["access"].get(
        "/api/v1/access/users", headers={"X-Demo-Role": "nursing"}
    )

    assert users.status_code == 200
    assert len(users.json()["users"]) == 5
    assert denied.status_code == 403


def test_access_changes_are_audited_before_being_applied(
    clients: dict[str, TestClient], monkeypatch: pytest.MonkeyPatch
) -> None:
    events: list[tuple[str, bool]] = []

    async def capture_event(principal, target_id: str, active: bool) -> None:
        events.append((target_id, active))

    monkeypatch.setattr(access, "record_audit_event", capture_event)
    response = clients["access"].patch(
        "/api/v1/access/users/demo-social",
        headers={"X-Demo-Role": "admin"},
        json={"active": False},
    )

    assert response.status_code == 200
    assert response.json()["active"] is False
    assert events == [("demo-social", False)]


def test_admin_demo_account_cannot_be_disabled(clients: dict[str, TestClient]) -> None:
    response = clients["access"].patch(
        "/api/v1/access/users/demo-admin",
        headers={"X-Demo-Role": "admin"},
        json={"active": False},
    )

    assert response.status_code == 409


def test_audit_requires_internal_token_and_excludes_payload_content(
    clients: dict[str, TestClient],
) -> None:
    payload = {
        "actor_name": "Renato Vieira",
        "actor_role": "admin",
        "action": "account_status_changed",
        "module": "administration",
        "target_id": "demo-social",
    }
    denied = clients["audit"].post("/internal/v1/events", json=payload)
    accepted = clients["audit"].post(
        "/internal/v1/events",
        headers={"X-Service-Token": "test-service-token"},
        json=payload,
    )
    events = clients["audit"].get(
        "/api/v1/audit/events", headers={"X-Demo-Role": "admin"}
    )

    assert denied.status_code == 403
    assert accepted.status_code == 201
    assert "payload" not in events.json()["events"][0]


def test_pharmacy_and_xray_endpoints_are_isolated_by_role(
    clients: dict[str, TestClient],
) -> None:
    inventory = clients["pharmacy"].get(
        "/api/v1/pharmacy/items", headers={"X-Demo-Role": "pharmacy"}
    )
    denied_inventory = clients["pharmacy"].get(
        "/api/v1/pharmacy/items", headers={"X-Demo-Role": "xray"}
    )
    request = clients["xray"].post(
        "/api/v1/xray/requests",
        headers={"X-Demo-Role": "xray"},
        json={"patient_reference": "DEMO-001", "exam_label": "Exame demonstrativo"},
    )

    assert inventory.status_code == 200
    assert denied_inventory.status_code == 403
    assert request.status_code == 201
    assert request.json()["status"] == "requested"


def test_social_service_only_accepts_fictitious_reference(
    clients: dict[str, TestClient],
) -> None:
    response = clients["social"].post(
        "/api/v1/social/referrals",
        headers={"X-Demo-Role": "social"},
        json={
            "patient_reference": "REAL-001",
            "referral_type": "Encaminhamento demonstrativo",
        },
    )

    assert response.status_code == 422
