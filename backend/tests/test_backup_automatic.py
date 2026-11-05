import os
import stat
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


def test_backup_config_persists_schedule_and_copy_retention(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SCPO_BACKUP_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(backup, "emit_audit_event", lambda *args, **kwargs: None)
    (tmp_path / ".gnupg").mkdir()
    backup._save_automatic_backup_state({"recipient": "A" * 40})
    payload = backup.AutomaticBackupConfig(
        directory="weekly",
        fingerprint_confirmation="A" * 40,
        schedule_type="weekly",
        run_time="03:15",
        weekdays=[0, 4],
        retention_count=12,
    )
    principal = backup.DemoPrincipal(
        "root",
        "root",
        "Root",
        "system_admin",
        ["admin"],
        {"admin": ["administrar"]},
        is_superuser=True,
    )

    status = backup.configure_automatic_backup(payload, principal)

    assert status["schedule"] == "Semanalmente (seg, sex) às 03:15 (America/Sao_Paulo)"
    assert status["retention_count"] == 12
    persisted = backup._load_automatic_backup_state()
    assert persisted["weekdays"] == [0, 4]
    assert persisted["run_time"] == "03:15"
    assert persisted["retention_count"] == 12


def test_backup_retention_keeps_configured_count_and_expires_files_after_30_days(
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


def test_backup_retention_keeps_only_the_most_recent_configured_count(
    tmp_path: Path,
) -> None:
    now = datetime(2026, 10, 31, tzinfo=UTC)
    backups = [tmp_path / f"scpo-connect-{index}.rgs" for index in range(4)]
    for index, path in enumerate(backups):
        path.write_bytes(b"encrypted")
        modified = (now - timedelta(days=index)).timestamp()
        os.utime(path, (modified, modified))

    assert backup._prune_automatic_backups(tmp_path, now, retention_count=2) == 2
    assert [path.exists() for path in backups] == [True, True, False, False]


def test_backup_retention_applies_maximum_storage_quota(tmp_path: Path) -> None:
    now = datetime(2026, 10, 31, tzinfo=UTC)
    oldest = tmp_path / "scpo-connect-old.rgs"
    newest = tmp_path / "scpo-connect-new.rgs"
    oldest.write_bytes(b"x" * 700)
    newest.write_bytes(b"x" * 700)
    os.utime(oldest, (now.timestamp() - 100, now.timestamp() - 100))
    os.utime(newest, (now.timestamp(), now.timestamp()))

    assert backup._prune_automatic_backups(tmp_path, now, max_storage_bytes=800) == 1
    assert not oldest.exists()
    assert newest.exists()


def test_password_encryption_state_can_be_saved_and_loaded(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SCPO_SESSION_SIGNING_KEY", "test-session-signing-key")
    state = {"automatic_password": backup._store_automatic_password("senha-segura-123")}

    assert backup._load_automatic_password(state) == "senha-segura-123"
    assert not backup._store_automatic_password("senha-segura-123")["ciphertext"].startswith(
        "senha-segura-123"
    )


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


def test_weekly_and_monthly_backup_schedules_select_configured_dates() -> None:
    timezone = ZoneInfo("America/Sao_Paulo")
    now = datetime(2026, 10, 31, 15, 0, tzinfo=UTC)
    weekly = {
        "directory": "daily",
        "recipient": "A" * 40,
        "schedule_type": "weekly",
        "run_time": "09:00",
        "weekdays": [0, 2],
    }

    assert backup._scheduled_occurrence(weekly, now, timezone, future=False) == datetime(
        2026, 10, 28, 9, 0, tzinfo=timezone
    )
    assert backup._scheduled_occurrence(weekly, now, timezone, future=True) == datetime(
        2026, 11, 2, 9, 0, tzinfo=timezone
    )

    monthly = {
        "directory": "daily",
        "recipient": "A" * 40,
        "schedule_type": "monthly",
        "run_time": "09:00",
        "month_days": [15, 31],
    }
    assert backup._scheduled_occurrence(monthly, now, timezone, future=False) == datetime(
        2026, 10, 31, 9, 0, tzinfo=timezone
    )
    assert backup._scheduled_occurrence(monthly, now, timezone, future=True) == datetime(
        2026, 11, 15, 9, 0, tzinfo=timezone
    )


def test_saving_a_schedule_does_not_run_an_already_missed_occurrence() -> None:
    timezone = ZoneInfo("America/Sao_Paulo")
    now = datetime(2026, 10, 31, 15, 0, tzinfo=UTC)
    state = {
        "directory": "weekly",
        "recipient": "A" * 40,
        "schedule_type": "weekly",
        "run_time": "09:00",
        "weekdays": [5],
        "schedule_updated_at": now.isoformat(),
    }

    assert not backup._should_run_automatic_backup(state, now, timezone)
    assert backup._scheduled_occurrence(state, now, timezone, future=True) == datetime(
        2026, 11, 7, 9, 0, tzinfo=timezone
    )


def test_interval_backup_schedule_is_anchored_and_does_not_run_early() -> None:
    timezone = ZoneInfo("America/Sao_Paulo")
    state = {
        "directory": "daily",
        "recipient": "A" * 40,
        "schedule_type": "interval",
        "interval_value": 2,
        "interval_unit": "hours",
        "run_time": "08:00",
        "schedule_anchor_at": "2026-10-31T08:00:00-03:00",
    }
    before_first_run = datetime(2026, 10, 31, 10, 0, tzinfo=UTC)
    after_second_run = datetime(2026, 10, 31, 15, 30, tzinfo=UTC)

    assert backup._scheduled_occurrence(
        state, before_first_run, timezone, future=False
    ) is None
    assert backup._scheduled_occurrence(
        state, after_second_run, timezone, future=False
    ) == datetime(2026, 10, 31, 12, 0, tzinfo=timezone)
    assert backup._scheduled_occurrence(
        state, after_second_run, timezone, future=True
    ) == datetime(2026, 10, 31, 14, 0, tzinfo=timezone)

    every_two_days = {
        **state,
        "interval_unit": "days",
        "run_time": "09:00",
        "schedule_anchor_at": "2026-10-28T09:00:00-03:00",
    }
    assert backup._scheduled_occurrence(
        every_two_days, after_second_run, timezone, future=False
    ) == datetime(2026, 10, 30, 9, 0, tzinfo=timezone)
    assert backup._scheduled_occurrence(
        every_two_days, after_second_run, timezone, future=True
    ) == datetime(2026, 11, 1, 9, 0, tzinfo=timezone)


def test_backup_schedule_rejects_empty_or_out_of_range_calendar_days() -> None:
    with pytest.raises(ValueError):
        backup.AutomaticBackupSchedule(schedule_type="weekly", weekdays=[])
    with pytest.raises(ValueError):
        backup.AutomaticBackupSchedule(schedule_type="monthly", month_days=[32])
    with pytest.raises(ValueError):
        backup.AutomaticBackupSchedule(
            schedule_type="interval", interval_unit="hours", interval_value=25
        )


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


def test_generated_gpg_key_is_password_protected_and_exported_without_persisting_password(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SCPO_BACKUP_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(backup, "emit_audit_event", lambda *args, **kwargs: None)
    principal = backup.DemoPrincipal(
        "root",
        "root",
        "Root",
        "system_admin",
        ["admin"],
        {"admin": ["administrar"]},
        is_superuser=True,
    )
    passphrase = "synthetic-only-gpg-passphrase"
    payload = backup.AutomaticBackupKeyRequest(
        identity="SCPO Synthetic Backup",
        passphrase=passphrase,
    )

    generated = backup.generate_automatic_backup_key(payload, principal)

    home = backup._generated_gpg_home()
    state = backup._load_automatic_backup_state()
    assert generated["fingerprint"] == state["recipient"]
    assert generated["fingerprint"] == backup._generated_private_key_fingerprint()
    assert stat.S_IMODE(home.stat().st_mode) == 0o700
    assert passphrase.encode() not in backup._automatic_backup_state_path().read_bytes()
    assert backup._automatic_backup_status()["private_key_configured"] is True

    exported = backup.export_automatic_backup_private_key(
        backup.AutomaticBackupKeyExportRequest(passphrase=passphrase),
        principal,
    )
    assert exported.body.startswith(b"-----BEGIN PGP PRIVATE KEY BLOCK-----")
    assert exported.headers["cache-control"] == "no-store"
    private_key_file = tmp_path / "synthetic-private-key.asc"
    private_key_file.write_bytes(exported.body)
    packets = subprocess.run(
        ["gpg", "--list-packets", str(private_key_file)],
        capture_output=True,
        check=True,
    )
    assert b"S2K" in packets.stdout

    with pytest.raises(HTTPException) as error:
        backup.export_automatic_backup_private_key(
            backup.AutomaticBackupKeyExportRequest(
                passphrase="incorrect-synthetic-passphrase"
            ),
            principal,
        )
    assert error.value.status_code == 422

    with pytest.raises(HTTPException) as error:
        backup.generate_automatic_backup_key(payload, principal)
    assert error.value.status_code == 409


def test_generated_gpg_key_requires_superadministrator(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SCPO_BACKUP_DATA_DIR", str(tmp_path))
    payload = backup.AutomaticBackupKeyRequest(
        identity="SCPO Synthetic Backup",
        passphrase="synthetic-only-gpg-passphrase",
    )
    principal = backup.DemoPrincipal(
        "operator",
        "operator",
        "Operator",
        "management",
        ["management"],
        {"management": ["administrar"]},
        is_superuser=False,
    )

    with pytest.raises(HTTPException) as error:
        backup.generate_automatic_backup_key(payload, principal)

    assert error.value.status_code == 403


def test_generated_gpg_key_replacement_requires_current_fingerprint_confirmation(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SCPO_BACKUP_DATA_DIR", str(tmp_path))
    backup._save_automatic_backup_state({"recipient": "A" * 40})
    payload = backup.AutomaticBackupKeyRequest(
        identity="SCPO Synthetic Backup",
        passphrase="synthetic-only-gpg-passphrase",
    )
    principal = backup.DemoPrincipal(
        "root",
        "root",
        "Root",
        "system_admin",
        ["admin"],
        {"admin": ["administrar"]},
        is_superuser=True,
    )

    with pytest.raises(HTTPException) as error:
        backup.generate_automatic_backup_key(payload, principal)

    assert error.value.status_code == 422
    assert not backup._generated_gpg_home().exists()


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
