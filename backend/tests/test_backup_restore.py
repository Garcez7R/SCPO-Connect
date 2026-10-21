import base64
import io
import json
import subprocess
import tarfile

import pytest
from fastapi.testclient import TestClient
from scpo_services import backup
from scpo_services.common import DemoPrincipal, authenticated_principal
from scpo_services.rgs_format import DATABASES


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
    assert all(command[0] == "pg_dump" for command in commands[:first_restore])
    imported = [
        command
        for command in commands
        if command[0] == "pg_restore" and "--list" not in command
    ]
    assert len(imported) == len(DATABASES)
    assert all("--single-transaction" in command for command in imported)


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
