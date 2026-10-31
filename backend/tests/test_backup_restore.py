import base64
import io
import json
import subprocess
import tarfile
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from scpo_services import backup
from scpo_services.common import DemoPrincipal, authenticated_principal
from scpo_services.rgs_format import DATABASES, MAGIC


def _add_file(archive: tarfile.TarFile, name: str, contents: bytes) -> None:
    info = tarfile.TarInfo(name)
    info.size = len(contents)
    archive.addfile(info, io.BytesIO(contents))


def _encrypted_bundle(password: str) -> bytes:
    bundle = io.BytesIO()
    with tarfile.open(fileobj=bundle, mode="w:gz") as archive:
        _add_file(
            archive,
            "manifest.json",
            json.dumps(
                {"format": "SCPO-RGS-1", "databases": list(DATABASES)}
            ).encode(),
        )
        for service in DATABASES:
            _add_file(archive, f"{service}.dump", f"backup-{service}".encode())
    return backup._encrypt(bundle.getvalue(), password)


def _principal(*, is_superuser: bool) -> DemoPrincipal:
    return DemoPrincipal(
        user_id="admin",
        username="rgarcez" if is_superuser else "operator",
        actor_name="Administrador",
        role="management",
        modules=["management"],
        permissions={"management": ["administrar"]},
        is_superuser=is_superuser,
    )


@pytest.fixture
def restore_client():
    backup.app.dependency_overrides[authenticated_principal] = lambda: _principal(
        is_superuser=True
    )
    with TestClient(backup.app) as client:
        yield client
    backup.app.dependency_overrides.clear()


def test_restore_requires_superuser_and_exact_confirmation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    backup.app.dependency_overrides[authenticated_principal] = lambda: _principal(
        is_superuser=False
    )
    monkeypatch.setattr(
        backup.subprocess,
        "run",
        lambda *args, **kwargs: pytest.fail("No database command should run"),
    )
    headers = {
        "content-type": "application/vnd.scpo.rgs",
        "x-rgs-password": base64.b64encode(b"strong-backup-password").decode(),
        "x-restore-confirmation": backup.RESTORE_CONFIRMATION,
    }
    try:
        with TestClient(backup.app) as client:
            unauthorized = client.put(
                "/api/v1/backup/restore", content=b"ignored", headers=headers
            )
            assert unauthorized.status_code == 403
            backup.app.dependency_overrides[authenticated_principal] = lambda: _principal(
                is_superuser=True
            )
            unconfirmed = client.put(
                "/api/v1/backup/restore",
                content=b"ignored",
                headers={**headers, "x-restore-confirmation": "yes"},
            )
            assert unconfirmed.status_code == 422
    finally:
        backup.app.dependency_overrides.clear()


def test_restore_validates_bundle_then_replaces_all_databases(
    restore_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    password = "strong-backup-password"
    commands: list[list[str]] = []

    def fake_run(command: list[str], **kwargs) -> subprocess.CompletedProcess:
        commands.append(command)
        if command[0] == "pg_dump":
            kwargs["stdout"].write(b"current database snapshot")
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr(backup, "_connection_args", lambda service: (["-d", service], {}))
    monkeypatch.setattr(backup.subprocess, "run", fake_run)
    monkeypatch.setattr(backup, "emit_audit_event", lambda *args, **kwargs: None)

    response = restore_client.put(
        "/api/v1/backup/restore",
        content=_encrypted_bundle(password),
        headers={
            "content-type": "application/vnd.scpo.rgs",
            "x-rgs-password": base64.b64encode(password.encode()).decode(),
            "x-restore-confirmation": backup.RESTORE_CONFIRMATION,
        },
    )

    assert response.status_code == 200
    assert response.json()["status"] == "restored"
    first_restore = next(index for index, command in enumerate(commands) if command[0] == "pg_restore" and "--list" not in command)
    imported = [
        command
        for command in commands
        if command[0] == "pg_restore" and "--list" not in command
    ]
    assert len(imported) == len(DATABASES)
    assert all("--single-transaction" in command for command in imported)
    validated = [
        command
        for command in commands
        if command[0] == "pg_restore" and "--list" in command
    ]
    assert len(validated) == len(DATABASES)
    first_snapshot = next(index for index, command in enumerate(commands) if command[0] == "pg_dump")
    assert all(commands.index(command) < first_snapshot for command in validated)
    assert all(command[0] == "pg_dump" for command in commands[first_snapshot:first_restore])
    assert len(commands[first_snapshot:first_restore]) == len(DATABASES)


def test_exported_rgs_can_be_restored_by_the_interface(
    restore_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    password = "strong-backup-password"
    operation_id = str(uuid4())
    commands: list[list[str]] = []

    def fake_run(command: list[str], **kwargs) -> subprocess.CompletedProcess:
        commands.append(command)
        if command[0] == "pg_dump":
            kwargs["stdout"].write(f"synthetic-{command[-1]}".encode())
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr(backup, "_connection_args", lambda service: (["-d", service], {}))
    monkeypatch.setattr(backup.subprocess, "run", fake_run)
    monkeypatch.setattr(backup, "emit_audit_event", lambda *args, **kwargs: None)

    exported = restore_client.post(
        "/api/v1/backup/export",
        json={"password": password},
    )
    assert exported.status_code == 200
    assert exported.headers["content-type"].startswith("application/vnd.scpo.rgs")
    assert exported.content.startswith(MAGIC)

    restored = restore_client.put(
        "/api/v1/backup/restore",
        content=exported.content,
        headers={
            "content-type": "application/vnd.scpo.rgs",
            "x-rgs-password": base64.b64encode(password.encode()).decode(),
            "x-restore-confirmation": backup.RESTORE_CONFIRMATION,
            "x-operation-id": operation_id,
        },
    )

    assert restored.status_code == 200
    assert restored.json()["status"] == "restored"
    assert sum(command[0] == "pg_restore" and "--list" in command for command in commands) == len(DATABASES)
    assert sum(command[0] == "pg_restore" and "--list" not in command for command in commands) == len(DATABASES)
    operation = restore_client.get(f"/api/v1/backup/operations/{operation_id}")
    assert operation.status_code == 200
    assert operation.json()["status"] == "completed"
    assert operation.json()["progress"] == 100


def test_restore_progress_can_be_polled_while_database_is_restoring(
    restore_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    password = "strong-backup-password"
    operation_id = str(uuid4())
    restore_started = Event()
    allow_restore_to_finish = Event()

    def fake_run(command: list[str], **kwargs) -> subprocess.CompletedProcess:
        if command[0] == "pg_dump":
            kwargs["stdout"].write(b"synthetic-database-snapshot")
        elif command[0] == "pg_restore" and "--list" not in command:
            restore_started.set()
            if not allow_restore_to_finish.wait(timeout=10):
                raise TimeoutError("test did not release the simulated restore")
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr(backup, "_connection_args", lambda service: (["-d", service], {}))
    monkeypatch.setattr(backup.subprocess, "run", fake_run)
    monkeypatch.setattr(backup, "emit_audit_event", lambda *args, **kwargs: None)
    content = _encrypted_bundle(password)
    headers = {
        "content-type": "application/vnd.scpo.rgs",
        "x-rgs-password": base64.b64encode(password.encode()).decode(),
        "x-restore-confirmation": backup.RESTORE_CONFIRMATION,
        "x-operation-id": operation_id,
    }

    def restore() -> Response:
        with TestClient(backup.app) as client:
            return client.put("/api/v1/backup/restore", content=content, headers=headers)

    with ThreadPoolExecutor(max_workers=1) as executor:
        restore_future = executor.submit(restore)
        try:
            assert restore_started.wait(timeout=10)
            operation = restore_client.get(f"/api/v1/backup/operations/{operation_id}")
            assert operation.status_code == 200
            assert operation.json()["status"] == "running"
            assert operation.json()["stage"] == "restoring"
            assert operation.json()["progress"] == 55
        finally:
            allow_restore_to_finish.set()

        response = restore_future.result(timeout=30)

    assert response.status_code == 200
    completed = restore_client.get(f"/api/v1/backup/operations/{operation_id}")
    assert completed.json()["status"] == "completed"


def test_restore_explains_automatic_gpg_bundle_requires_isolated_flow(
    restore_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        backup.subprocess,
        "run",
        lambda *args, **kwargs: pytest.fail("GPG bundle must be rejected before database commands"),
    )

    response = restore_client.put(
        "/api/v1/backup/restore",
        content=b"not-an-aes-gcm-rgs",
        headers={
            "content-type": "application/vnd.scpo.rgs",
            "x-rgs-password": base64.b64encode(b"strong-backup-password").decode(),
            "x-restore-confirmation": backup.RESTORE_CONFIRMATION,
        },
    )

    assert response.status_code == 422
    assert "Backups automáticos GPG" in response.json()["detail"]
    assert "nenhum banco" not in response.json()["detail"].lower()


def test_restore_rejects_invalid_postgres_dump_before_backing_up_or_changing_databases(
    restore_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    password = "strong-backup-password"
    operation_id = str(uuid4())
    commands: list[list[str]] = []

    def fake_run(command: list[str], **kwargs) -> subprocess.CompletedProcess:
        commands.append(command)
        if command[0] == "pg_restore" and "--list" in command:
            raise subprocess.CalledProcessError(1, command, stderr=b"not a PostgreSQL dump")
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr(backup, "_connection_args", lambda service: (["-d", service], {}))
    monkeypatch.setattr(backup.subprocess, "run", fake_run)

    response = restore_client.put(
        "/api/v1/backup/restore",
        content=_encrypted_bundle(password),
        headers={
            "content-type": "application/vnd.scpo.rgs",
            "x-rgs-password": base64.b64encode(password.encode()).decode(),
            "x-restore-confirmation": backup.RESTORE_CONFIRMATION,
            "x-operation-id": operation_id,
        },
    )

    assert response.status_code == 422
    assert "nenhum banco foi alterado" in response.json()["detail"]
    assert commands and commands[0][0] == "pg_restore"
    assert all(command[0] == "pg_restore" for command in commands)
    operation = restore_client.get(f"/api/v1/backup/operations/{operation_id}")
    assert operation.status_code == 200
    assert operation.json()["status"] == "failed"


def test_restore_rolls_back_already_restored_databases_on_failure(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    commands: list[list[str]] = []
    failed_import = False

    def fake_run(command: list[str], **kwargs) -> subprocess.CompletedProcess:
        nonlocal failed_import
        commands.append(command)
        if command[0] == "pg_dump":
            kwargs["stdout"].write(b"prior data")
        elif (
            command[0] == "pg_restore"
            and "--list" not in command
            and command[-1].endswith("/social.dump")
            and "scpo-restore-safety-" not in command[-1]
            and not failed_import
        ):
            failed_import = True
            raise subprocess.CalledProcessError(1, command, stderr=b"restore error")
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr(backup, "_connection_args", lambda service: (["-d", service], {}))
    monkeypatch.setattr(backup.subprocess, "run", fake_run)
    dumps_dir = tmp_path / "dumps"
    dumps_dir.mkdir()
    for service in DATABASES:
        (dumps_dir / f"{service}.dump").write_bytes(f"new-{service}".encode())

    with pytest.raises(subprocess.CalledProcessError):
        backup._restore_all_databases(dumps_dir)

    restored = [
        command[-1]
        for command in commands
        if command[0] == "pg_restore" and "--list" not in command
    ]
    safety_restores = [path for path in restored if "scpo-restore-safety-" in path]
    assert [path.rsplit("/", 1)[-1] for path in safety_restores] == [
        "pharmacy.dump",
        "nursing.dump",
        "audit.dump",
        "access.dump",
    ]
