import os
import subprocess
import tarfile
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import BinaryIO, cast
from zoneinfo import ZoneInfo

import pytest
from fastapi import HTTPException
from scpo_services import backup


def test_backup_destination_is_confined_to_base_volume(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SCPO_BACKUP_DATA_DIR", str(tmp_path))

    assert backup._resolve_automatic_destination("institutional/daily") == (
        tmp_path / "institutional" / "daily"
    )
    for invalid in ("", "../outside", "institutional/../../outside", "/absolute", r"a\b"):
        with pytest.raises(ValueError):
            backup._resolve_automatic_destination(invalid)

    outside = tmp_path.parent / f"{tmp_path.name}-outside"
    outside.mkdir()
    (tmp_path / "escape").symlink_to(outside, target_is_directory=True)
    with pytest.raises(ValueError, match="volume-base"):
        backup._resolve_automatic_destination("escape/daily")


def test_backup_config_requires_a_verified_public_key_fingerprint(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SCPO_BACKUP_DATA_DIR", str(tmp_path))
    (tmp_path / ".gnupg").mkdir()
    backup._save_automatic_backup_state(
        {"recipient": "A" * 40, "directory": "previous"}
    )

    with pytest.raises(HTTPException) as error:
        backup.configure_automatic_backup(
            backup.AutomaticBackupConfig(
                directory="daily",
                fingerprint_confirmation="B" * 40,
            ),
            backup.DemoPrincipal(
                "root",
                "root",
                "Root",
                "system_admin",
                ["admin"],
                {"admin": ["administrar"]},
                is_superuser=True,
            ),
        )
    assert error.value.status_code == 422
    assert backup._load_automatic_backup_state()["directory"] == "previous"


def test_backup_retention_removes_only_rgs_files_older_than_30_days(
    tmp_path: Path,
) -> None:
    old_backup = tmp_path / "scpo-connect-old.rgs"
    recent_backup = tmp_path / "scpo-connect-recent.rgs"
    unrelated = tmp_path / "other.rgs"
    for path in (old_backup, recent_backup, unrelated):
        path.write_bytes(b"encrypted")
    now = datetime(2026, 10, 31, tzinfo=UTC)
    old_time = (now - timedelta(days=31)).timestamp()
    recent_time = (now - timedelta(days=2)).timestamp()
    os.utime(old_backup, (old_time, old_time))
    os.utime(recent_backup, (recent_time, recent_time))
    os.utime(unrelated, (old_time, old_time))

    assert backup._prune_automatic_backups(tmp_path, now) == 1
    assert not old_backup.exists()
    assert recent_backup.exists()
    assert unrelated.exists()


def test_backup_schedule_retries_failed_runs_at_most_hourly() -> None:
    timezone = ZoneInfo("America/Sao_Paulo")
    now = datetime(2026, 10, 31, 15, 0, tzinfo=UTC)
    state = {"directory": "daily", "recipient": "A" * 40}

    assert backup._should_run_automatic_backup(state, now, timezone)
    state["last_success_date"] = now.astimezone(timezone).date().isoformat()
    assert not backup._should_run_automatic_backup(state, now, timezone)
    state.pop("last_success_date")
    state["last_attempt_at"] = (now - timedelta(minutes=45)).isoformat()
    assert not backup._should_run_automatic_backup(state, now, timezone)
    state["last_attempt_at"] = (now - timedelta(hours=1, minutes=1)).isoformat()
    assert backup._should_run_automatic_backup(state, now, timezone)


def test_backup_rejects_private_or_unarmored_gpg_keys(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SCPO_BACKUP_DATA_DIR", str(tmp_path))

    with pytest.raises(HTTPException, match="chave pública"):
        backup._import_public_key(
            b"-----BEGIN PGP PRIVATE KEY BLOCK-----\ninvalid\n"
        )
    with pytest.raises(HTTPException, match="ASCII-armored"):
        backup._import_public_key(b"binary-key-data")


def test_automatic_backup_packages_all_database_and_file_sources(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    base = tmp_path / "base"
    destination = base / "daily"
    destination.mkdir(parents=True)
    key_home = base / ".gnupg"
    key_home.mkdir()
    env_file = tmp_path / ".env"
    env_file.write_text("synthetic=only", encoding="utf-8")
    caddy = tmp_path / "caddy"
    caddy.mkdir()
    (caddy / "certificate.crt").write_bytes(b"synthetic-certificate")
    therapy = tmp_path / "therapy"
    therapy.mkdir()
    (therapy / "image.png").write_bytes(b"synthetic-image")
    monkeypatch.setenv("SCPO_BACKUP_DATA_DIR", str(base))
    monkeypatch.setenv("SCPO_BACKUP_ENV_FILE", str(env_file))
    monkeypatch.setenv("SCPO_BACKUP_CADDY_DIR", str(caddy))
    monkeypatch.setenv("SCPO_BACKUP_THERAPY_DIR", str(therapy))
    backup._save_automatic_backup_state(
        {"directory": "daily", "recipient": "A" * 40}
    )
    monkeypatch.setattr(backup, "_connection_args", lambda _service: ([], {}))

    def fake_run(arguments: list[str], **kwargs: object) -> subprocess.CompletedProcess[bytes]:
        if arguments[0] == "pg_dump":
            output = cast(BinaryIO, kwargs["stdout"])
            output.write(b"synthetic-database-dump")
        else:
            archive_path = Path(arguments[-1])
            with tarfile.open(archive_path, mode="r:gz") as archive:
                names = set(archive.getnames())
            expected_dumps = {
                f"dumps/scpo_{service}.dump" for service in backup.DATABASES
            }
            assert expected_dumps.issubset(names)
            assert "attachments/env/.env" in names
            assert "attachments/caddy-data/certificate.crt" in names
            assert "attachments/therapy-materials/image.png" in names
            output_path = Path(arguments[arguments.index("--output") + 1])
            output_path.write_bytes(b"encrypted-bundle")
        return subprocess.CompletedProcess(arguments, 0, stdout=b"", stderr=b"")

    monkeypatch.setattr(backup.subprocess, "run", fake_run)

    created = backup._create_automatic_backup()

    assert created.parent == destination
    assert created.read_bytes() == b"encrypted-bundle"
    assert not list(destination.glob(".scpo-backup-*"))
