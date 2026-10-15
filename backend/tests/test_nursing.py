from collections.abc import Generator

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from scpo_services.common import clear_engine_cache
from scpo_services.nursing import app


@pytest.fixture
def client(tmp_path, monkeypatch) -> Generator[TestClient, None, None]:
    monkeypatch.setenv(
        "SCPO_NURSING_DATABASE_URL", f"sqlite:///{tmp_path / 'nursing.sqlite3'}"
    )
    monkeypatch.setenv("SCPO_SERVICE", "nursing")
    clear_engine_cache()
    command.upgrade(Config("alembic.ini"), "head")
    with TestClient(app) as test_client:
        yield test_client
    clear_engine_cache()


def test_nursing_profile_can_save_fictitious_record(client: TestClient) -> None:
    response = client.post(
        "/api/v1/nursing/vitals",
        headers={"X-Demo-Role": "nursing"},
        json={
            "patient_reference": "DEMO-001",
            "values": {
                "saturation": "98",
                "pressure": "120/80",
                "notes": "Observação fictícia",
            },
            "glucose_unit": "mg/dL",
            "not_applicable": ["glucose"],
        },
    )

    assert response.status_code == 201
    assert response.json()["patient_reference"] == "DEMO-001"
    assert response.json()["actor_id"] == "Marina Nunes"


def test_administration_cannot_access_nursing_records(client: TestClient) -> None:
    response = client.post(
        "/api/v1/nursing/vitals",
        headers={"X-Demo-Role": "admin"},
        json={"patient_reference": "DEMO-001", "values": {}},
    )

    assert response.status_code == 403


def test_service_requires_a_demo_profile(client: TestClient) -> None:
    response = client.get("/api/v1/nursing/vitals")

    assert response.status_code == 401


def test_service_rejects_non_demo_patient_reference(client: TestClient) -> None:
    response = client.post(
        "/api/v1/nursing/vitals",
        headers={"X-Demo-Role": "nursing"},
        json={"patient_reference": "REAL-123", "values": {}},
    )

    assert response.status_code == 422


def test_service_validates_values_without_clinical_thresholds(
    client: TestClient,
) -> None:
    response = client.post(
        "/api/v1/nursing/vitals",
        headers={"X-Demo-Role": "nursing"},
        json={"patient_reference": "DEMO-001", "values": {"saturation": "999999"}},
    )

    assert response.status_code == 201
