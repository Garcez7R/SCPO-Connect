"""Administrator-only encrypted full database exports using the .rgs format."""

import asyncio
import base64
import binascii
import hmac
import io
import json
import logging
import os
import re
import secrets
import shutil
import subprocess
import tarfile
import tempfile
import threading
from collections.abc import Callable
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path, PurePosixPath
from typing import Annotated, Literal
from urllib.parse import unquote, urlparse
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import Response
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    SecretStr,
    ValidationError,
    field_validator,
    model_validator,
)

from .common import DemoPrincipal, authenticated_principal, emit_audit_event
from .rgs_format import (
    DATABASES,
    MAGIC,
    decrypt_and_extract,
    decrypt_automatic_and_extract,
)

AUTHENTICATED = Depends(authenticated_principal)
RESTORE_CONFIRMATION = "SUBSTITUIR TODOS OS DADOS"
RESTORE_LOCK = threading.Lock()
RESTORE_OPERATIONS_LOCK = threading.Lock()
RESTORE_OPERATIONS: dict[str, dict[str, object]] = {}
RESTORE_OPERATION_RETENTION = timedelta(hours=2)
AUTO_BACKUP_LOCK = threading.Lock()
AUTO_BACKUP_RETENTION_DAYS = 30
AUTO_BACKUP_RETENTION_COUNT = 30
AUTO_BACKUP_DEFAULT_TIME = "02:00"
LOW_DISK_SPACE_FRACTION = 0.1
MAX_PUBLIC_KEY_BYTES = 64 * 1024
MAX_PRIVATE_KEY_BYTES = 64 * 1024
MAX_AUTOMATIC_BACKUP_BYTES = 20 * 1024**3
logger = logging.getLogger(__name__)


class ExportRequest(BaseModel):
    password: str = Field(min_length=12, max_length=128)


class AutomaticBackupSchedule(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schedule_type: Literal["daily", "interval", "weekly", "monthly"] = "daily"
    interval_value: int = Field(default=1, ge=1, le=365)
    interval_unit: Literal["hours", "days"] = "days"
    run_time: str = Field(default=AUTO_BACKUP_DEFAULT_TIME, pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")
    weekdays: list[int] = Field(default_factory=lambda: list(range(7)))
    month_days: list[int] = Field(default_factory=lambda: [1])
    retention_count: int = Field(default=AUTO_BACKUP_RETENTION_COUNT, ge=1, le=365)

    @field_validator("weekdays")
    @classmethod
    def validate_weekdays(cls, weekdays: list[int]) -> list[int]:
        if not weekdays or len(set(weekdays)) != len(weekdays) or any(
            weekday < 0 or weekday > 6 for weekday in weekdays
        ):
            raise ValueError("Selecione ao menos um dia da semana válido")
        return sorted(weekdays)

    @field_validator("month_days")
    @classmethod
    def validate_month_days(cls, month_days: list[int]) -> list[int]:
        if not month_days or len(set(month_days)) != len(month_days) or any(
            day < 1 or day > 31 for day in month_days
        ):
            raise ValueError("Selecione ao menos um dia do mês entre 1 e 31")
        return sorted(month_days)

    @model_validator(mode="after")
    def validate_interval(self) -> "AutomaticBackupSchedule":
        if self.schedule_type == "interval" and self.interval_unit == "hours" and self.interval_value > 24:
            raise ValueError("O intervalo em horas deve ser de 1 a 24")
        return self


class AutomaticBackupConfig(AutomaticBackupSchedule):
    directory: str = Field(min_length=1, max_length=200)
    fingerprint_confirmation: str = Field(
        default="",
        min_length=0,
        max_length=64,
    )
    encryption_type: Literal["gpg", "password"] = "gpg"
    password: SecretStr | None = Field(default=None, min_length=12, max_length=128)
    max_storage_bytes: int | None = Field(default=None, ge=1, le=20 * 1024**4)


class AutomaticBackupKeyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    identity: str = Field(min_length=3, max_length=100)
    passphrase: SecretStr = Field(min_length=16, max_length=128)
    fingerprint_confirmation: str | None = Field(
        default=None,
        pattern=r"^(?:[A-Fa-f0-9]{40}|[A-Fa-f0-9]{64})?$",
    )

    @field_validator("identity")
    @classmethod
    def validate_identity(cls, identity: str) -> str:
        identity = identity.strip()
        if (
            len(identity) < 3
            or identity.startswith("-")
            or any(ord(character) < 32 for character in identity)
        ):
            raise ValueError("Informe uma identificação válida para a chave")
        return identity


class AutomaticBackupKeyExportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    passphrase: SecretStr = Field(min_length=16, max_length=128)


class AutomaticBackupRestoreRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    backup_name: str = Field(pattern=r"^scpo-connect-\d{8}T\d{6}Z\.rgs$")
    confirmation: str = Field(max_length=64)
    operation_id: UUID
    backup_password: SecretStr | None = Field(default=None, max_length=128)
    key_passphrase: SecretStr | None = Field(default=None, max_length=128)
    private_key: str | None = Field(default=None, max_length=MAX_PRIVATE_KEY_BYTES)


def _automatic_schedule(state: dict[str, object]) -> AutomaticBackupSchedule:
    try:
        return AutomaticBackupSchedule.model_validate(
            {
                "schedule_type": state.get("schedule_type", "daily"),
                "interval_value": state.get("interval_value", 1),
                "interval_unit": state.get("interval_unit", "days"),
                "run_time": state.get("run_time", AUTO_BACKUP_DEFAULT_TIME),
                "weekdays": state.get("weekdays", list(range(7))),
                "month_days": state.get("month_days", [1]),
                "retention_count": state.get(
                    "retention_count", AUTO_BACKUP_RETENTION_COUNT
                ),
            }
        )
    except ValidationError as exc:
        raise RuntimeError("A configuração de agenda do backup está inválida") from exc


def _local_run_time(run_date: date, run_time: str, timezone: ZoneInfo) -> datetime:
    parsed_time = time.fromisoformat(run_time)
    return datetime.combine(run_date, parsed_time, tzinfo=timezone)


def _schedule_anchor(
    state: dict[str, object], timezone: ZoneInfo
) -> datetime:
    anchor_value = state.get("schedule_anchor_at")
    if not isinstance(anchor_value, str):
        raise TypeError("A âncora da agenda por intervalo está ausente")
    try:
        anchor = datetime.fromisoformat(anchor_value)
    except ValueError as exc:
        raise RuntimeError("A âncora da agenda do backup está inválida") from exc
    if anchor.tzinfo is None:
        anchor = anchor.replace(tzinfo=UTC)
    return anchor.astimezone(timezone)


def _scheduled_occurrence(
    state: dict[str, object],
    now: datetime,
    timezone: ZoneInfo,
    *,
    future: bool,
) -> datetime | None:
    schedule = _automatic_schedule(state)
    local_now = now.astimezone(timezone)
    if schedule.schedule_type == "interval":
        anchor = _schedule_anchor(state, timezone)
        if now.astimezone(UTC) < anchor.astimezone(UTC):
            return anchor if future else None
        if schedule.interval_unit == "hours":
            interval = timedelta(hours=schedule.interval_value)
            elapsed = (now.astimezone(UTC) - anchor.astimezone(UTC)).total_seconds()
            step = max(0, int(elapsed // interval.total_seconds()))
            candidate = anchor.astimezone(UTC) + interval * step
            if future and candidate <= now.astimezone(UTC):
                candidate += interval
            elif not future and candidate > now.astimezone(UTC):
                candidate -= interval
            return candidate.astimezone(timezone)

        interval_days = schedule.interval_value
        day_delta = (local_now.date() - anchor.date()).days
        step = max(0, day_delta // interval_days)
        candidate = _local_run_time(
            anchor.date() + timedelta(days=step * interval_days),
            schedule.run_time,
            timezone,
        )
        if future and candidate <= local_now:
            candidate = _local_run_time(
                anchor.date() + timedelta(days=(step + 1) * interval_days),
                schedule.run_time,
                timezone,
            )
        elif not future and candidate > local_now:
            candidate = _local_run_time(
                anchor.date() + timedelta(days=max(0, step - 1) * interval_days),
                schedule.run_time,
                timezone,
            )
        return candidate

    offsets = range(372) if future else range(0, -372, -1)
    for offset in offsets:
        candidate_date = local_now.date() + timedelta(days=offset)
        if schedule.schedule_type == "weekly" and candidate_date.weekday() not in schedule.weekdays:
            continue
        if schedule.schedule_type == "monthly" and candidate_date.day not in schedule.month_days:
            continue
        candidate = _local_run_time(candidate_date, schedule.run_time, timezone)
        if future and candidate > local_now:
            return candidate
        if not future and candidate <= local_now:
            return candidate
    return None


def _schedule_description(
    schedule: AutomaticBackupSchedule, timezone_name: str
) -> str:
    if schedule.schedule_type == "interval":
        unit = "hora" if schedule.interval_unit == "hours" else "dia"
        plural = "" if schedule.interval_value == 1 else "s"
        return f"A cada {schedule.interval_value} {unit}{plural}, às {schedule.run_time} ({timezone_name})"
    if schedule.schedule_type == "weekly":
        weekday_names = ("seg", "ter", "qua", "qui", "sex", "sáb", "dom")
        days = ", ".join(weekday_names[day] for day in schedule.weekdays)
        return f"Semanalmente ({days}) às {schedule.run_time} ({timezone_name})"
    if schedule.schedule_type == "monthly":
        days = ", ".join(str(day) for day in schedule.month_days)
        return f"Mensalmente (dias {days}) às {schedule.run_time} ({timezone_name})"
    return f"Diariamente às {schedule.run_time} ({timezone_name})"


def _backup_data_dir() -> Path:
    return Path(os.getenv("SCPO_BACKUP_DATA_DIR", "/var/lib/scpo-backup"))


def _automatic_backup_state_path() -> Path:
    return _backup_data_dir() / ".automatic-backup-state.json"


def _load_automatic_backup_state() -> dict[str, object]:
    try:
        value = json.loads(_automatic_backup_state_path().read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError("Não foi possível ler a configuração persistente do backup") from exc
    if not isinstance(value, dict):
        raise TypeError("A configuração persistente do backup está inválida")
    return value


def _save_automatic_backup_state(state: dict[str, object]) -> None:
    root = _backup_data_dir()
    root.mkdir(parents=True, exist_ok=True, mode=0o750)
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=root,
            prefix=".automatic-backup-state.",
            suffix=".tmp",
            delete=False,
        ) as temporary:
            temporary_path = Path(temporary.name)
            os.chmod(temporary_path, 0o600)
            json.dump(state, temporary, ensure_ascii=False, sort_keys=True)
            temporary.flush()
            os.fsync(temporary.fileno())
        os.replace(temporary_path, _automatic_backup_state_path())
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def _resolve_automatic_destination(relative_directory: str) -> Path:
    if (
        not relative_directory
        or relative_directory != relative_directory.strip()
        or "\\" in relative_directory
        or "\x00" in relative_directory
    ):
        raise ValueError("Informe uma subpasta relativa válida")
    relative_path = PurePosixPath(relative_directory)
    if relative_path.is_absolute() or any(
        part in {"", ".", ".."} for part in relative_path.parts
    ):
        raise ValueError("O destino deve permanecer dentro do volume-base")
    root = _backup_data_dir().resolve()
    destination = root.joinpath(*relative_path.parts).resolve()
    if not destination.is_relative_to(root) or destination == root:
        raise ValueError("O destino deve permanecer dentro do volume-base")
    return destination


def _gpg_home() -> Path:
    return _backup_data_dir() / ".gnupg"


def _generated_gpg_home() -> Path:
    return _backup_data_dir() / ".generated-gpg"


def _generated_private_key_fingerprint() -> str | None:
    home = _generated_gpg_home()
    if home.is_symlink():
        raise RuntimeError("O diretório da chave GPG gerada não é seguro")
    if not home.is_dir():
        return None
    try:
        result = subprocess.run(
            [
                "gpg",
                "--batch",
                "--homedir",
                str(home),
                "--with-colons",
                "--list-secret-keys",
            ],
            capture_output=True,
            check=True,
            timeout=15,
        )
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        logger.error("Could not inspect the generated automatic-backup key")
        raise RuntimeError("Não foi possível verificar a chave GPG protegida") from exc
    records = result.stdout.decode("utf-8", errors="replace").splitlines()
    secret_records = [
        index for index, record in enumerate(records) if record.startswith("sec:")
    ]
    if not secret_records:
        return None
    if len(secret_records) != 1:
        raise RuntimeError("O armazenamento deve conter somente uma chave GPG gerada")
    fingerprint = next(
        (
            record.split(":")[9]
            for record in records[secret_records[0] + 1 :]
            if record.startswith("fpr:")
        ),
        "",
    )
    if not fingerprint or any(
        character not in "0123456789ABCDEFabcdef" for character in fingerprint
    ):
        raise RuntimeError("Não foi possível identificar a chave GPG gerada")
    return fingerprint.upper()


def _automatic_backup_files() -> list[dict[str, object]]:
    state = _load_automatic_backup_state()
    directory = state.get("directory")
    if not isinstance(directory, str):
        return []
    destination = _resolve_automatic_destination(directory)
    if destination.is_symlink() or not destination.is_dir():
        return []
    records: list[dict[str, object]] = []
    for path in destination.glob("scpo-connect-*.rgs"):
        if not re.fullmatch(r"scpo-connect-\d{8}T\d{6}Z\.rgs", path.name):
            continue
        if path.is_symlink() or not path.is_file():
            continue
        try:
            resolved_path = path.resolve(strict=True)
            if resolved_path.parent != destination.resolve(strict=True):
                continue
            metadata = resolved_path.stat()
            if metadata.st_size <= 0 or metadata.st_size > MAX_AUTOMATIC_BACKUP_BYTES:
                continue
            with resolved_path.open("rb") as source:
                is_password_bundle = source.read(len(MAGIC)) == MAGIC
        except OSError:
            logger.warning("Could not inspect an automatic backup file")
            continue
        records.append({
            "name": path.name,
            "created_at": datetime.fromtimestamp(metadata.st_mtime, UTC).isoformat(),
            "size_bytes": metadata.st_size,
            "encryption_type": "password" if is_password_bundle else "gpg",
        })
    return sorted(records, key=lambda record: (str(record["created_at"]), str(record["name"])), reverse=True)


def _automatic_backup_path(backup_name: str) -> Path:
    if not re.fullmatch(r"scpo-connect-\d{8}T\d{6}Z\.rgs", backup_name):
        raise HTTPException(status_code=422, detail="Nome de backup automático inválido")
    state = _load_automatic_backup_state()
    directory = state.get("directory")
    if not isinstance(directory, str):
        raise HTTPException(status_code=409, detail="O destino de backup automático não está configurado")
    destination = _resolve_automatic_destination(directory)
    path = destination / backup_name
    try:
        resolved_destination = destination.resolve(strict=True)
        resolved_path = path.resolve(strict=True)
        metadata = path.lstat()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="O backup selecionado não está mais disponível") from exc
    except OSError as exc:
        raise HTTPException(status_code=503, detail="Não foi possível acessar o backup selecionado") from exc
    if (
        path.is_symlink()
        or not path.is_file()
        or resolved_path.parent != resolved_destination
        or metadata.st_size <= 0
        or metadata.st_size > MAX_AUTOMATIC_BACKUP_BYTES
    ):
        raise HTTPException(status_code=422, detail="O arquivo selecionado não é um backup automático válido")
    return path


def _secret_key_fingerprints(home: Path) -> list[str]:
    try:
        result = subprocess.run(
            [
                "gpg",
                "--batch",
                "--homedir",
                str(home),
                "--with-colons",
                "--list-secret-keys",
            ],
            capture_output=True,
            check=True,
            timeout=15,
        )
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        raise HTTPException(status_code=422, detail="Não foi possível ler a chave privada GPG") from exc
    records = result.stdout.decode("utf-8", errors="replace").splitlines()
    fingerprints: list[str] = []
    for index, record in enumerate(records):
        if not record.startswith("sec:"):
            continue
        fingerprint = next(
            (
                following.split(":")[9]
                for following in records[index + 1 :]
                if following.startswith(("sec:", "fpr:"))
            ),
            "",
        )
        if fingerprint and fingerprint not in fingerprints:
            fingerprints.append(fingerprint.upper())
    return fingerprints


def _decrypt_automatic_backup(
    source: Path,
    destination: Path,
    payload: AutomaticBackupRestoreRequest,
    state: dict[str, object],
) -> None:
    with source.open("rb") as encrypted:
        is_password_bundle = encrypted.read(len(MAGIC)) == MAGIC
    if is_password_bundle:
        password = (
            payload.backup_password.get_secret_value()
            if payload.backup_password is not None
            else _load_automatic_password(state)
        )
        decrypt_automatic_and_extract(source, destination, password=password)
        return

    temporary_home: tempfile.TemporaryDirectory[str] | None = None
    if payload.private_key is not None:
        try:
            private_key = payload.private_key.encode("ascii")
        except UnicodeEncodeError as exc:
            raise HTTPException(
                status_code=422,
                detail="Envie uma única chave privada GPG ASCII-armored válida",
            ) from exc
        private_marker = b"-----BEGIN PGP PRIVATE KEY BLOCK-----"
        if (
            not private_key.strip().startswith(private_marker)
            or private_key.count(private_marker) != 1
            or b"-----END PGP PRIVATE KEY BLOCK-----" not in private_key
        ):
            raise HTTPException(
                status_code=422,
                detail="Envie uma única chave privada GPG ASCII-armored válida",
            )
        temporary_home = tempfile.TemporaryDirectory(prefix="scpo-restore-gpg-")
        home = Path(temporary_home.name)
        os.chmod(home, 0o700)
        try:
            subprocess.run(
                ["gpg", "--batch", "--homedir", str(home), "--import"],
                input=private_key,
                capture_output=True,
                check=True,
                timeout=30,
            )
        except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
            temporary_home.cleanup()
            raise HTTPException(status_code=422, detail="A chave privada GPG enviada não pôde ser importada") from exc
        try:
            fingerprints = _secret_key_fingerprints(home)
        except HTTPException:
            temporary_home.cleanup()
            raise
        if len(fingerprints) != 1:
            temporary_home.cleanup()
            raise HTTPException(status_code=422, detail="Envie uma chave privada GPG por vez")
    else:
        expected_fingerprint = state.get("recipient")
        home = _generated_gpg_home()
        fingerprint = _generated_private_key_fingerprint()
        if (
            not isinstance(expected_fingerprint, str)
            or fingerprint is None
            or not hmac.compare_digest(fingerprint, expected_fingerprint.upper())
        ):
            raise HTTPException(
                status_code=409,
                detail="A chave privada correspondente não está no servidor. Envie a cópia privada custodiada para esta restauração.",
            )

    try:
        decrypt_automatic_and_extract(
            source,
            destination,
            gpg_home=home,
            passphrase=payload.key_passphrase.get_secret_value()
            if payload.key_passphrase is not None
            else None,
        )
    finally:
        if temporary_home is not None:
            try:
                subprocess.run(
                    ["gpgconf", "--homedir", str(home), "--kill", "gpg-agent"],
                    capture_output=True,
                    check=False,
                    timeout=10,
                )
            except (OSError, subprocess.TimeoutExpired):
                logger.warning("Could not stop the temporary GPG agent after automatic restore")
            temporary_home.cleanup()


def _stop_generated_gpg_agent(home: Path) -> None:
    try:
        subprocess.run(
            ["gpgconf", "--homedir", str(home), "--kill", "gpg-agent"],
            capture_output=True,
            check=True,
            timeout=10,
        )
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        logger.error("Could not stop the generated automatic-backup GPG agent")
        raise RuntimeError("Não foi possível encerrar o agente temporário da chave GPG") from exc


def _automatic_backup_status() -> dict[str, object]:
    state = _load_automatic_backup_state()
    private_key_fingerprint = _generated_private_key_fingerprint()
    schedule = _automatic_schedule(state)
    directory = state.get("directory")
    recipient = state.get("recipient")
    encryption_type = state.get("encryption_type", "gpg")
    password_configured = isinstance(state.get("automatic_password"), dict)
    configured = isinstance(directory, str) and (
        (encryption_type == "gpg" and isinstance(recipient, str))
        or (encryption_type == "password" and password_configured)
    )
    destination = _resolve_automatic_destination(directory) if configured else None
    base = _backup_data_dir()
    base_available = base.is_dir() and os.access(base, os.W_OK)
    destination_available = bool(
        destination and destination.is_dir() and os.access(destination, os.W_OK)
    )
    disk_path = destination or base
    disk = shutil.disk_usage(disk_path) if disk_path.exists() else None
    free_bytes = disk.free if disk else None
    used_bytes = (
        sum(
            path.stat().st_size
            for path in destination.glob("scpo-connect-*.rgs")
            if not path.is_symlink() and path.is_file()
        )
        if destination and destination.is_dir()
        else 0
    ) if configured else 0
    low_space = bool(
        disk and disk.total > 0 and disk.free / disk.total < LOW_DISK_SPACE_FRACTION
    )
    timezone_name = os.getenv("SCPO_BACKUP_TIMEZONE", "America/Sao_Paulo")
    timezone = ZoneInfo(timezone_name)
    now = datetime.now(timezone)
    next_run = _scheduled_occurrence(state, now, timezone, future=True)
    due_run = _scheduled_occurrence(state, now, timezone, future=False)
    if next_run is None:
        raise RuntimeError("Não foi possível calcular a próxima execução do backup")
    if configured and due_run is not None and not _schedule_slot_succeeded(state, due_run):
        next_attempt = now.replace(second=0, microsecond=0) + timedelta(minutes=1)
        last_attempt = state.get("last_attempt_at")
        if isinstance(last_attempt, str):
            try:
                attempt_time = datetime.fromisoformat(last_attempt)
                if attempt_time.tzinfo is None:
                    attempt_time = attempt_time.replace(tzinfo=UTC)
                next_attempt = max(
                    next_attempt,
                    attempt_time.astimezone(timezone) + timedelta(hours=1),
                )
            except ValueError as exc:
                raise RuntimeError("Data da última tentativa de backup está inválida") from exc
        next_run = min(next_run, next_attempt)
    return {
        "enabled": configured and base_available and destination_available,
        "configured": configured,
        "base_volume_available": base_available,
        "destination_available": destination_available,
        "destination_directory": directory if configured else None,
        "recipient_configured": bool(recipient),
        "recipient_fingerprint": recipient,
        "encryption_type": encryption_type,
        "password_configured": password_configured,
        "max_storage_bytes": state.get("max_storage_bytes"),
        "storage_used_bytes": used_bytes,
        "private_key_configured": private_key_fingerprint is not None,
        "private_key_fingerprint": private_key_fingerprint,
        "schedule": _schedule_description(schedule, timezone_name),
        "schedule_type": schedule.schedule_type,
        "interval_value": schedule.interval_value,
        "interval_unit": schedule.interval_unit,
        "run_time": schedule.run_time,
        "weekdays": schedule.weekdays,
        "month_days": schedule.month_days,
        "retention_count": schedule.retention_count,
        "retention_days": AUTO_BACKUP_RETENTION_DAYS,
        "next_run_at": next_run.isoformat(),
        "last_attempt_at": state.get("last_attempt_at"),
        "last_success_at": state.get("last_success_at"),
        "last_backup_name": state.get("last_backup_name"),
        "last_error": state.get("last_error"),
        "free_space_bytes": free_bytes,
        "low_space_warning": low_space,
        "immutability_validated": False,
    }


def _copy_tree_without_symlinks(source: Path, destination: Path) -> int:
    if not source.is_dir() or source.is_symlink():
        raise RuntimeError(f"Diretório necessário ao backup indisponível: {source.name}")
    copied_files = 0
    destination.mkdir(parents=True, exist_ok=True)
    for source_path in sorted(source.rglob("*")):
        if source_path.is_symlink():
            raise RuntimeError(f"O backup encontrou um link simbólico em {source.name}")
        relative_path = source_path.relative_to(source)
        destination_path = destination / relative_path
        if source_path.is_dir():
            destination_path.mkdir(parents=True, exist_ok=True)
        elif source_path.is_file():
            destination_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source_path, destination_path)
            copied_files += 1
        else:
            raise RuntimeError(f"Tipo de arquivo não permitido em {source.name}")
    return copied_files


def _prune_automatic_backups(
    destination: Path,
    now: datetime | None = None,
    retention_count: int = AUTO_BACKUP_RETENTION_COUNT,
    max_storage_bytes: int | None = None,
) -> int:
    if retention_count < 1:
        raise ValueError("A quantidade de backups mantidos deve ser positiva")
    cutoff = (now or datetime.now(UTC)) - timedelta(days=AUTO_BACKUP_RETENTION_DAYS)
    backups = sorted(
        (
            backup
            for backup in destination.glob("scpo-connect-*.rgs")
            if not backup.is_symlink() and backup.is_file()
        ),
        key=lambda backup: (backup.stat().st_mtime, backup.name),
        reverse=True,
    )
    removed = 0
    for index, backup in enumerate(backups):
        modified_at = datetime.fromtimestamp(backup.stat().st_mtime, UTC)
        if index >= retention_count or modified_at < cutoff:
            backup.unlink()
            removed += 1
    if max_storage_bytes is not None:
        backups = [
            backup for backup in destination.glob("scpo-connect-*.rgs")
            if not backup.is_symlink() and backup.is_file()
        ]
        backups.sort(key=lambda backup: (backup.stat().st_mtime, backup.name), reverse=True)
        total = sum(backup.stat().st_size for backup in backups)
        while total > max_storage_bytes and backups:
            oldest = backups.pop()
            total -= oldest.stat().st_size
            oldest.unlink()
            removed += 1
    return removed


def _remove_stale_backup_staging(destination: Path, now: datetime | None = None) -> int:
    cutoff = (now or datetime.now(UTC)) - timedelta(days=1)
    removed = 0
    for staging in destination.glob(".scpo-backup-*"):
        if staging.is_symlink() or not staging.is_dir():
            continue
        modified_at = datetime.fromtimestamp(staging.stat().st_mtime, UTC)
        if modified_at < cutoff:
            shutil.rmtree(staging)
            removed += 1
    return removed


def _automatic_password_key() -> bytes:
    import hashlib

    secret = os.getenv("SCPO_SESSION_SIGNING_KEY") or os.getenv("SCPO_SERVICE_TOKEN")
    if not secret:
        raise RuntimeError("A chave de proteção da sessão não está configurada")
    return hashlib.sha256(("scpo-auto-backup-password:" + secret).encode()).digest()


def _store_automatic_password(password: str) -> dict[str, str]:
    nonce = secrets.token_bytes(12)
    encrypted = AESGCM(_automatic_password_key()).encrypt(
        nonce, password.encode("utf-8"), b"scpo-auto-backup-password"
    )
    return {
        "nonce": base64.b64encode(nonce).decode("ascii"),
        "ciphertext": base64.b64encode(encrypted).decode("ascii"),
    }


def _load_automatic_password(state: dict[str, object]) -> str:
    secret = state.get("automatic_password")
    if not isinstance(secret, dict):
        raise TypeError("A senha do backup automático não está configurada")
    try:
        nonce = base64.b64decode(str(secret["nonce"]), validate=True)
        ciphertext = base64.b64decode(str(secret["ciphertext"]), validate=True)
        value = AESGCM(_automatic_password_key()).decrypt(
            nonce, ciphertext, b"scpo-auto-backup-password"
        )
        return value.decode("utf-8")
    except (KeyError, ValueError, InvalidTag, UnicodeDecodeError, binascii.Error) as exc:
        raise RuntimeError("Não foi possível recuperar a senha do backup automático") from exc


def _create_automatic_backup() -> Path:
    state = _load_automatic_backup_state()
    directory = state.get("directory")
    recipient = state.get("recipient")
    encryption_type = state.get("encryption_type", "gpg")
    if not isinstance(directory, str):
        raise TypeError("Configure o destino antes de ativar backups")
    if encryption_type == "gpg" and not isinstance(recipient, str):
        raise TypeError("Configure a chave pública antes de ativar backups por GPG")
    if encryption_type == "password" and not isinstance(state.get("automatic_password"), dict):
        raise TypeError("Configure a senha antes de ativar backups por senha")
    destination = _resolve_automatic_destination(directory)
    if not destination.is_dir() or not os.access(destination, os.W_OK):
        raise RuntimeError("A subpasta de backup não está disponível para gravação")
    env_file = Path(os.getenv("SCPO_BACKUP_ENV_FILE", "/run/secrets/scpo-env"))
    caddy_directory = Path(os.getenv("SCPO_BACKUP_CADDY_DIR", "/mnt/caddy-data"))
    therapy_directory = Path(
        os.getenv("SCPO_BACKUP_THERAPY_DIR", "/mnt/therapy-materials")
    )
    therapy_album_directory_value = os.getenv("SCPO_BACKUP_THERAPY_ALBUM_DIR")
    if not env_file.is_file() or env_file.is_symlink():
        raise RuntimeError("O arquivo .env não está disponível para backup")
    if encryption_type == "gpg" and not _gpg_home().is_dir():
        raise RuntimeError("A chave pública GPG configurada não está disponível")

    schedule = _automatic_schedule(state)
    max_storage_bytes = state.get("max_storage_bytes")
    if not isinstance(max_storage_bytes, int):
        max_storage_bytes = None
    _prune_automatic_backups(
        destination,
        retention_count=schedule.retention_count,
        max_storage_bytes=max_storage_bytes,
    )
    _remove_stale_backup_staging(destination)
    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    backup_path = destination / f"scpo-connect-{timestamp}.rgs"
    if backup_path.exists():
        raise RuntimeError("Já existe um backup com o mesmo identificador de horário")
    with tempfile.TemporaryDirectory(prefix=".scpo-backup-", dir=destination) as temporary:
        staging = Path(temporary)
        dumps = staging / "dumps"
        attachments = staging / "attachments"
        dumps.mkdir(mode=0o700)
        (attachments / "env").mkdir(parents=True, mode=0o700)
        shutil.copyfile(env_file, attachments / "env" / ".env")
        caddy_count = _copy_tree_without_symlinks(
            caddy_directory, attachments / "caddy-data"
        )
        therapy_count = _copy_tree_without_symlinks(
            therapy_directory, attachments / "therapy-materials"
        )
        therapy_album_count = 0
        if therapy_album_directory_value:
            therapy_album_count = _copy_tree_without_symlinks(
                Path(therapy_album_directory_value), attachments / "therapy-album"
            )

        databases = tuple(f"scpo_{service}" for service in DATABASES)
        for service, database in zip(DATABASES, databases, strict=True):
            args, env = _connection_args(service)
            with (dumps / f"{database}.dump").open("wb") as output:
                subprocess.run(
                    [
                        "pg_dump",
                        *args,
                        "--format=custom",
                        "--no-owner",
                        "--no-privileges",
                    ],
                    env=env,
                    stdout=output,
                    stderr=subprocess.PIPE,
                    check=True,
                    timeout=1800,
                )
        manifest = (
            "SCPO Connect backup\n"
            f"Formato: RGS v1 ({'senha AES-GCM' if encryption_type == 'password' else 'GPG'})\n"
            f"Criado em UTC: {timestamp}\n"
            f"Bancos: {' '.join(databases)}\n"
            "Anexos: .env, autoridade Caddy, Biblioteca e Álbum da Oficina Terapêutica\n"
            f"Arquivos Caddy: {caddy_count}; Biblioteca: {therapy_count}; "
            f"Álbum: {therapy_album_count}\n"
            "Contém dados pessoais e clínicos protegidos por criptografia do modo configurado.\n"
        )
        (staging / "MANIFEST.txt").write_text(manifest, encoding="utf-8")
        archive_path = staging / "bundle.tar.gz"
        with tarfile.open(archive_path, mode="w:gz") as archive:
            for path in sorted(staging.iterdir()):
                if path != archive_path:
                    archive.add(path, arcname=path.relative_to(staging).as_posix())
        encrypted_path = staging / "bundle.rgs"
        if encryption_type == "password":
            encrypted_path.write_bytes(
                _encrypt(archive_path.read_bytes(), _load_automatic_password(state))
            )
        else:
            subprocess.run(
                [
                    "gpg",
                    "--batch",
                    "--yes",
                    "--trust-model",
                    "always",
                    "--homedir",
                    str(_gpg_home()),
                    "--encrypt",
                    "--recipient",
                    str(recipient),
                    "--output",
                    str(encrypted_path),
                    str(archive_path),
                ],
                check=True,
                capture_output=True,
                timeout=1800,
            )
        os.chmod(encrypted_path, 0o600)
        os.replace(encrypted_path, backup_path)
    _prune_automatic_backups(
        destination,
        retention_count=schedule.retention_count,
        max_storage_bytes=max_storage_bytes,
    )
    return backup_path


def _should_run_automatic_backup(
    state: dict[str, object],
    now: datetime,
    timezone: ZoneInfo,
) -> bool:
    if not isinstance(state.get("directory"), str):
        return False
    encryption_type = state.get("encryption_type", "gpg")
    if encryption_type == "password":
        if not isinstance(state.get("automatic_password"), dict):
            return False
    elif not isinstance(state.get("recipient"), str):
        return False
    due_run = _scheduled_occurrence(state, now, timezone, future=False)
    if due_run is None or _schedule_slot_succeeded(state, due_run):
        return False
    last_attempt = state.get("last_attempt_at")
    if isinstance(last_attempt, str):
        try:
            attempt_time = datetime.fromisoformat(last_attempt)
            if attempt_time.tzinfo is None:
                attempt_time = attempt_time.replace(tzinfo=UTC)
            if now - attempt_time.astimezone(UTC) < timedelta(hours=1):
                return False
        except ValueError as exc:
            raise RuntimeError("Data da última tentativa de backup está inválida") from exc
    return True


def _schedule_slot_succeeded(state: dict[str, object], due_run: datetime) -> bool:
    schedule_updated_at = state.get("schedule_updated_at")
    if isinstance(schedule_updated_at, str):
        try:
            configured_at = datetime.fromisoformat(schedule_updated_at)
        except ValueError as exc:
            raise RuntimeError("Data da configuração do backup está inválida") from exc
        if configured_at.tzinfo is None:
            configured_at = configured_at.replace(tzinfo=UTC)
        if due_run.astimezone(UTC) <= configured_at.astimezone(UTC):
            return True
    last_success = state.get("last_success_at")
    if isinstance(last_success, str):
        try:
            success_time = datetime.fromisoformat(last_success)
        except ValueError as exc:
            raise RuntimeError("Data do último backup concluído está inválida") from exc
        if success_time.tzinfo is None:
            success_time = success_time.replace(tzinfo=UTC)
        if success_time.astimezone(UTC) >= due_run.astimezone(UTC):
            return True
    return (
        state.get("schedule_type", "daily") == "daily"
        and state.get("last_success_date") == due_run.date().isoformat()
    )


async def _run_automatic_backup_worker() -> None:
    timezone = ZoneInfo(os.getenv("SCPO_BACKUP_TIMEZONE", "America/Sao_Paulo"))
    while True:
        try:
            now = datetime.now(UTC)
            state = _load_automatic_backup_state()
            if _should_run_automatic_backup(state, now, timezone) and AUTO_BACKUP_LOCK.acquire(
                blocking=False
            ):
                try:
                    scheduled_slot = _scheduled_occurrence(
                        state, now, timezone, future=False
                    )
                    if scheduled_slot is None:
                        raise RuntimeError("Não foi possível determinar o horário agendado")
                    state["last_attempt_at"] = now.isoformat()
                    state["last_error"] = None
                    _save_automatic_backup_state(state)
                    backup_path = await asyncio.to_thread(_create_automatic_backup)
                    state = _load_automatic_backup_state()
                    state["last_success_at"] = datetime.now(UTC).isoformat()
                    state["last_success_date"] = now.astimezone(timezone).date().isoformat()
                    state["last_success_slot"] = scheduled_slot.isoformat()
                    state["last_backup_name"] = backup_path.name
                    state["last_error"] = None
                    _save_automatic_backup_state(state)
                except Exception:
                    logger.exception("Automatic SCPO backup failed")
                    failed_state = _load_automatic_backup_state()
                    failed_state["last_error"] = (
                        "A última rotina falhou; consulte os logs do serviço de backup."
                    )
                    _save_automatic_backup_state(failed_state)
                finally:
                    AUTO_BACKUP_LOCK.release()
        except Exception:
            logger.exception("Automatic SCPO backup worker could not read its configuration")
        await asyncio.sleep(60)


@asynccontextmanager
async def lifespan(_: FastAPI):
    timezone_name = os.getenv("SCPO_BACKUP_TIMEZONE", "America/Sao_Paulo")
    try:
        ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError as exc:
        raise RuntimeError(f"Fuso horário de backup inválido: {timezone_name}") from exc
    task = asyncio.create_task(_run_automatic_backup_worker())
    try:
        yield
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


app = FastAPI(
    title="SCPO Connect · Backup",
    version="1.0.0",
    lifespan=lifespan,
)


def _require_admin(principal: DemoPrincipal) -> None:
    if not principal.is_superuser:
        raise HTTPException(status_code=403, detail="Acesso não autorizado para esta operação")


def _update_restore_operation(
    operation_id: str | None,
    *,
    status: str,
    stage: str,
    message: str,
    progress: int | None,
) -> None:
    if operation_id is None:
        return
    now = datetime.now(UTC)
    with RESTORE_OPERATIONS_LOCK:
        cutoff = now - RESTORE_OPERATION_RETENTION
        expired = [
            existing_id
            for existing_id, operation in RESTORE_OPERATIONS.items()
            if operation.get("status") != "running"
            and isinstance(operation.get("updated_at"), str)
            and datetime.fromisoformat(str(operation["updated_at"])) < cutoff
        ]
        for existing_id in expired:
            RESTORE_OPERATIONS.pop(existing_id, None)
        RESTORE_OPERATIONS[operation_id] = {
            "status": status,
            "stage": stage,
            "message": message,
            "progress": progress,
            "updated_at": now.isoformat(),
        }


def _read_restore_operation(operation_id: str) -> dict[str, object] | None:
    with RESTORE_OPERATIONS_LOCK:
        operation = RESTORE_OPERATIONS.get(operation_id)
        if (
            operation is not None
            and operation.get("status") != "running"
            and isinstance(operation.get("updated_at"), str)
            and datetime.fromisoformat(str(operation["updated_at"]))
            < datetime.now(UTC) - RESTORE_OPERATION_RETENTION
        ):
            RESTORE_OPERATIONS.pop(operation_id, None)
            return None
        return dict(operation) if operation is not None else None


def _parse_restore_operation_id(request: Request) -> str | None:
    value = request.headers.get("x-operation-id")
    if value is None:
        return None
    try:
        return str(UUID(value))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Identificador da operação inválido") from exc


def _connection_args(service: str) -> tuple[list[str], dict[str, str]]:
    parsed = urlparse(os.getenv(f"SCPO_{service.upper()}_DATABASE_URL", ""))
    if parsed.scheme not in {"postgres", "postgresql", "postgresql+psycopg"} or not parsed.hostname:
        raise HTTPException(status_code=503, detail=f"Banco de {service} não está configurado para backup")

    args = [
        "-h",
        parsed.hostname,
        "-p",
        str(parsed.port or 5432),
        "-U",
        unquote(parsed.username or ""),
        "-d",
        parsed.path.lstrip("/"),
    ]
    env = dict(os.environ)
    env["PGPASSWORD"] = unquote(parsed.password or "")
    return args, env


def _encrypt(data: bytes, password: str) -> bytes:
    import hashlib

    salt, nonce = secrets.token_bytes(16), secrets.token_bytes(12)
    key = hashlib.scrypt(password.encode(), salt=salt, n=2**15, r=8, p=1, maxmem=64 * 1024 * 1024, dklen=32)
    return MAGIC + salt + nonce + AESGCM(key).encrypt(nonce, data, MAGIC)


def _create_bundle(password: str) -> bytes:
    with tempfile.TemporaryDirectory(prefix="scpo-rgs-") as temp:
        root = Path(temp)
        manifest = {"format": "SCPO-RGS-1", "created_at": datetime.now(UTC).isoformat(), "databases": list(DATABASES)}
        (root / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
        for service in DATABASES:
            args, env = _connection_args(service)
            with (root / f"{service}.dump").open("wb") as output:
                subprocess.run(
                    ["pg_dump", *args, "--format=custom", "--no-owner", "--no-privileges"],
                    env=env,
                    stdout=output,
                    stderr=subprocess.PIPE,
                    check=True,
                    timeout=900,
                )
        content = io.BytesIO()
        with tarfile.open(fileobj=content, mode="w:gz") as archive:
            for path in root.iterdir():
                archive.add(path, arcname=path.name)
        return _encrypt(content.getvalue(), password)


def _restore_database(service: str, dump_path: Path) -> None:
    args, env = _connection_args(service)
    subprocess.run(
        [
            "pg_restore",
            "--clean",
            "--if-exists",
            "--exit-on-error",
            "--no-owner",
            "--no-privileges",
            "--single-transaction",
            *args,
            str(dump_path),
        ],
        env=env,
        check=True,
        capture_output=True,
        timeout=1800,
    )


def _validate_database_dump(dump_path: Path) -> None:
    if not dump_path.is_file():
        raise ValueError(f"Dump ausente: {dump_path.name}")
    if dump_path.stat().st_size <= 0:
        raise ValueError(f"Dump vazio: {dump_path.name}")
    subprocess.run(
        ["pg_restore", "--list", str(dump_path)],
        check=True,
        capture_output=True,
        timeout=120,
    )


def _restore_all_databases(
    dumps_dir: Path,
    on_progress: Callable[[str, int, int], None] | None = None,
) -> None:
    restored: list[str] = []
    with tempfile.TemporaryDirectory(prefix="scpo-restore-safety-") as safety_dir:
        safety_path = Path(safety_dir)
        try:
            total = len(DATABASES)
            for index, service in enumerate(DATABASES, start=1):
                args, env = _connection_args(service)
                snapshot = safety_path / f"{service}.dump"
                with snapshot.open("wb") as output:
                    subprocess.run(
                        [
                            "pg_dump",
                            *args,
                            "--format=custom",
                            "--no-owner",
                            "--no-privileges",
                        ],
                        env=env,
                        stdout=output,
                        stderr=subprocess.PIPE,
                        check=True,
                        timeout=1800,
                    )
                if on_progress is not None:
                    on_progress("snapshot", index, total)
            for index, service in enumerate(DATABASES, start=1):
                if on_progress is not None:
                    on_progress("restore_started", index, total)
                _restore_database(service, dumps_dir / f"{service}.dump")
                restored.append(service)
                if on_progress is not None:
                    on_progress("restore_completed", index, total)
        except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
            rollback_failures: list[str] = []
            for service in reversed(restored):
                try:
                    _restore_database(service, safety_path / f"{service}.dump")
                except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
                    rollback_failures.append(service)
            if rollback_failures:
                logger.exception(
                    "Backup restore failed and automatic rollback was incomplete: %s",
                    ", ".join(rollback_failures),
                )
                raise RuntimeError(
                    "A restauração falhou e a recuperação automática também falhou para "
                    f"{', '.join(rollback_failures)}. Intervenção técnica imediata necessária."
                ) from exc
            raise


async def _save_upload(request: Request, destination: Path) -> None:
    max_bytes = int(os.getenv("SCPO_MAX_RESTORE_BYTES", str(5 * 1024**3)))
    if max_bytes < 1 or max_bytes > 20 * 1024**3:
        raise HTTPException(status_code=500, detail="Limite de restauração inválido na configuração")

    content_length = request.headers.get("content-length")
    if content_length is not None:
        try:
            declared_size = int(content_length)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Tamanho do arquivo inválido") from exc
        if declared_size > max_bytes:
            raise HTTPException(status_code=413, detail="O arquivo excede o limite de restauração")

    received = 0
    with destination.open("wb") as output:
        async for chunk in request.stream():
            received += len(chunk)
            if received > max_bytes:
                raise HTTPException(status_code=413, detail="O arquivo excede o limite de restauração")
            output.write(chunk)
    if content_length is not None and received != declared_size:
        raise HTTPException(status_code=400, detail="O arquivo enviado está incompleto")
    if received == 0:
        raise HTTPException(status_code=400, detail="Selecione um arquivo de backup")


def _restore_password(request: Request) -> str:
    encoded = request.headers.get("x-rgs-password")
    if not encoded:
        raise HTTPException(status_code=422, detail="Informe a senha do backup")
    try:
        password = base64.b64decode(encoded, validate=True).decode("utf-8")
    except (binascii.Error, UnicodeDecodeError) as exc:
        raise HTTPException(status_code=422, detail="A senha do backup está em formato inválido") from exc
    if not 12 <= len(password) <= 128:
        raise HTTPException(status_code=422, detail="A senha deve ter entre 12 e 128 caracteres")
    return password


async def _read_public_key(request: Request) -> bytes:
    content_length = request.headers.get("content-length")
    if content_length is not None:
        try:
            declared_size = int(content_length)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Tamanho da chave inválido") from exc
        if declared_size > MAX_PUBLIC_KEY_BYTES:
            raise HTTPException(status_code=413, detail="A chave pública excede 64 KB")
    content = bytearray()
    async for chunk in request.stream():
        content.extend(chunk)
        if len(content) > MAX_PUBLIC_KEY_BYTES:
            raise HTTPException(status_code=413, detail="A chave pública excede 64 KB")
    if not content:
        raise HTTPException(status_code=400, detail="Envie uma chave pública GPG")
    return bytes(content)


def _import_public_key(public_key: bytes) -> str:
    armored_key = public_key.strip()
    public_marker = b"-----BEGIN PGP PUBLIC KEY BLOCK-----"
    if (
        not armored_key.startswith(public_marker)
        or b"PRIVATE KEY" in armored_key
        or b"SECRET KEY" in armored_key
        or armored_key.count(public_marker) != 1
    ):
        raise HTTPException(
            status_code=422,
            detail="Envie somente uma chave pública GPG em formato ASCII-armored",
        )
    home = _gpg_home()
    home.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(home, 0o700)
    try:
        details = subprocess.run(
            [
                "gpg",
                "--batch",
                "--homedir",
                str(home),
                "--with-colons",
                "--show-keys",
            ],
            input=public_key,
            capture_output=True,
            check=True,
            timeout=15,
        )
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        logger.error("Could not parse the supplied automatic-backup public key")
        raise HTTPException(status_code=422, detail="A chave pública GPG é inválida") from exc
    records = details.stdout.decode("utf-8", errors="replace").splitlines()
    public_key_records = [index for index, record in enumerate(records) if record.startswith("pub:")]
    if len(public_key_records) != 1:
        raise HTTPException(
            status_code=422,
            detail="Envie um arquivo com exatamente uma chave pública GPG",
        )
    key_index = public_key_records[0]
    fingerprint = next(
        (
            record.split(":")[9]
            for record in records[key_index + 1 :]
            if record.startswith("fpr:")
        ),
        "",
    )
    if not fingerprint or any(character not in "0123456789ABCDEFabcdef" for character in fingerprint):
        raise HTTPException(status_code=422, detail="Não foi possível identificar a chave GPG")
    try:
        subprocess.run(
            ["gpg", "--batch", "--homedir", str(home), "--import"],
            input=public_key,
            capture_output=True,
            check=True,
            timeout=15,
        )
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        logger.error("Could not import the supplied automatic-backup public key")
        raise HTTPException(status_code=422, detail="Não foi possível importar a chave pública GPG") from exc
    return fingerprint.upper()


@app.get("/api/v1/backup/automatic/status")
def automatic_backup_status(
    principal: Annotated[DemoPrincipal, AUTHENTICATED],
) -> dict[str, object]:
    _require_admin(principal)
    try:
        status = _automatic_backup_status()
    except (OSError, RuntimeError, ValueError) as exc:
        logger.exception("Could not read automatic backup status")
        raise HTTPException(
            status_code=503,
            detail="Não foi possível ler o estado do backup automático",
        ) from exc
    emit_audit_event(
        principal,
        "management",
        "automatic_backup_status_read",
        "backup_configuration",
        service="access",
    )
    return status


@app.get("/api/v1/backup/automatic/files")
def automatic_backup_files(
    principal: Annotated[DemoPrincipal, AUTHENTICATED],
) -> dict[str, object]:
    _require_admin(principal)
    try:
        files = _automatic_backup_files()
    except (OSError, RuntimeError, ValueError) as exc:
        logger.exception("Could not list automatic backup files")
        raise HTTPException(
            status_code=503,
            detail="Não foi possível listar os backups automáticos",
        ) from exc
    emit_audit_event(
        principal,
        "management",
        "automatic_backup_files_read",
        "automatic_backups",
        service="access",
    )
    return {"files": files}


@app.post("/api/v1/backup/automatic/restore")
async def restore_automatic_backup(
    payload: AutomaticBackupRestoreRequest,
    principal: Annotated[DemoPrincipal, AUTHENTICATED],
) -> dict[str, str]:
    _require_admin(principal)
    if payload.confirmation != RESTORE_CONFIRMATION:
        raise HTTPException(
            status_code=422,
            detail=f"Digite exatamente: {RESTORE_CONFIRMATION}",
        )
    source = _automatic_backup_path(payload.backup_name)
    state = _load_automatic_backup_state()
    operation_id = str(payload.operation_id)
    if not RESTORE_LOCK.acquire(blocking=False):
        _update_restore_operation(
            operation_id,
            status="failed",
            stage="rejected",
            message="Já existe uma restauração em andamento.",
            progress=None,
        )
        raise HTTPException(status_code=409, detail="Já existe uma restauração em andamento")

    _update_restore_operation(
        operation_id,
        status="running",
        stage="decrypting",
        message=f"Descriptografando o backup automático selecionado ({payload.backup_name}).",
        progress=5,
    )
    try:
        with tempfile.TemporaryDirectory(prefix="scpo-automatic-restore-") as temporary:
            root = Path(temporary)
            dumps = root / "dumps"
            try:
                await asyncio.to_thread(
                    _decrypt_automatic_backup,
                    source,
                    dumps,
                    payload,
                    state,
                )
            except HTTPException:
                raise
            except (
                InvalidTag,
                OSError,
                RuntimeError,
                TypeError,
                ValueError,
                tarfile.TarError,
                subprocess.SubprocessError,
            ) as exc:
                raise HTTPException(
                    status_code=422,
                    detail="Não foi possível validar o backup automático: confira a senha/chave e se o arquivo está íntegro. Nenhum banco foi alterado.",
                ) from exc

            total = len(DATABASES)
            _update_restore_operation(
                operation_id,
                status="running",
                stage="validating",
                message="Validando os sete bancos antes de alterar os dados atuais.",
                progress=10,
            )
            for index, service in enumerate(DATABASES, start=1):
                try:
                    await asyncio.to_thread(
                        _validate_database_dump,
                        dumps / f"{service}.dump",
                    )
                except (OSError, subprocess.SubprocessError, ValueError) as exc:
                    raise HTTPException(
                        status_code=422,
                        detail=f"O banco {service} do backup automático é inválido. Nenhum banco foi alterado.",
                    ) from exc
                _update_restore_operation(
                    operation_id,
                    status="running",
                    stage="validating",
                    message=f"Banco {service} validado ({index}/{total}).",
                    progress=10 + round(index / total * 20),
                )

            def report_restore_progress(stage: str, completed: int, total: int) -> None:
                if stage == "snapshot":
                    progress = 30 + round(completed / total * 25)
                    message = f"Cópia temporária criada ({completed}/{total})."
                    operation_stage = "snapshotting"
                elif stage == "restore_started":
                    progress = 55 + round((completed - 1) / total * 44)
                    message = f"Restaurando banco {DATABASES[completed - 1]} ({completed}/{total})."
                    operation_stage = "restoring"
                else:
                    progress = 55 + round(completed / total * 44)
                    message = f"Banco {DATABASES[completed - 1]} restaurado ({completed}/{total})."
                    operation_stage = "restoring"
                _update_restore_operation(
                    operation_id,
                    status="running",
                    stage=operation_stage,
                    message=message,
                    progress=progress,
                )

            try:
                await asyncio.to_thread(
                    _restore_all_databases,
                    dumps,
                    report_restore_progress,
                )
            except RuntimeError as exc:
                logger.exception("Automatic backup restore and rollback failed")
                raise HTTPException(status_code=500, detail=str(exc)) from exc
            except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
                logger.exception("Automatic backup restore failed; automatic rollback succeeded")
                raise HTTPException(
                    status_code=503,
                    detail="A restauração falhou. Os dados anteriores foram recuperados automaticamente.",
                ) from exc

        emit_audit_event(
            principal,
            "management",
            "automatic_backup_restored",
            payload.backup_name,
            service="access",
        )
        _update_restore_operation(
            operation_id,
            status="completed",
            stage="completed",
            message=(
                "Os sete bancos foram restaurados. Anexos do pacote automático "
                "(.env, Caddy, Biblioteca e Álbum) não foram aplicados."
            ),
            progress=100,
        )
        return {
            "status": "restored",
            "message": (
                "Os sete bancos foram restaurados. Anexos do pacote automático "
                "(.env, Caddy, Biblioteca e Álbum) não foram aplicados."
            ),
        }
    except HTTPException as exc:
        _update_restore_operation(
            operation_id,
            status="failed",
            stage="failed",
            message=str(exc.detail),
            progress=None,
        )
        raise
    finally:
        operation = _read_restore_operation(operation_id)
        if operation is not None and operation.get("status") == "running":
            _update_restore_operation(
                operation_id,
                status="failed",
                stage="failed",
                message=(
                    "A restauração foi interrompida antes da conclusão. Confira o estado "
                    "dos serviços antes de iniciar outra operação."
                ),
                progress=None,
            )
        RESTORE_LOCK.release()


@app.put("/api/v1/backup/automatic/public-key")
async def import_automatic_backup_public_key(
    request: Request,
    principal: Annotated[DemoPrincipal, AUTHENTICATED],
) -> dict[str, str]:
    _require_admin(principal)
    public_key = await _read_public_key(request)
    fingerprint = _import_public_key(public_key)
    state = _load_automatic_backup_state()
    state["recipient"] = fingerprint
    state.pop("directory", None)
    state["last_error"] = None
    _save_automatic_backup_state(state)
    emit_audit_event(
        principal,
        "management",
        "automatic_backup_public_key_imported",
        fingerprint,
        service="access",
    )
    return {"fingerprint": fingerprint}


@app.post("/api/v1/backup/automatic/key")
def generate_automatic_backup_key(
    payload: AutomaticBackupKeyRequest,
    principal: Annotated[DemoPrincipal, AUTHENTICATED],
) -> dict[str, str]:
    _require_admin(principal)
    try:
        if _generated_private_key_fingerprint() is not None:
            raise HTTPException(
                status_code=409,
                detail="Já existe uma chave privada GPG gerada no servidor; exporte-a antes de qualquer troca.",
            )
        state = _load_automatic_backup_state()
        current_recipient = state.get("recipient")
        confirmation = payload.fingerprint_confirmation
        if isinstance(current_recipient, str) and current_recipient and (
            not confirmation
            or not hmac.compare_digest(
                current_recipient.upper(), confirmation.upper()
            )
        ):
            raise HTTPException(
                status_code=422,
                detail="Confirme a impressão digital atual antes de substituir a chave pública.",
            )
        home = _generated_gpg_home()
        if home.is_symlink():
            raise RuntimeError("O diretório da chave GPG gerada não é seguro")
        home.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(home, 0o700)
        passphrase = payload.passphrase.get_secret_value()
        try:
            subprocess.run(
                [
                    "gpg",
                    "--batch",
                    "--homedir",
                    str(home),
                    "--pinentry-mode",
                    "loopback",
                    "--passphrase-fd",
                    "0",
                    "--quick-generate-key",
                    payload.identity,
                    "rsa3072",
                    "encr",
                    "0",
                ],
                input=f"{passphrase}\n".encode(),
                capture_output=True,
                check=True,
                timeout=120,
            )
        finally:
            _stop_generated_gpg_agent(home)
        fingerprint = _generated_private_key_fingerprint()
        if fingerprint is None:
            raise RuntimeError("A geração não produziu uma chave privada GPG")
        public_key = subprocess.run(
            ["gpg", "--batch", "--homedir", str(home), "--armor", "--export", fingerprint],
            capture_output=True,
            check=True,
            timeout=20,
        ).stdout
        imported_fingerprint = _import_public_key(public_key)
        if not hmac.compare_digest(fingerprint, imported_fingerprint):
            raise RuntimeError("A impressão digital da chave GPG exportada não corresponde")
        state["recipient"] = fingerprint
        state.pop("directory", None)
        state["last_error"] = None
        _save_automatic_backup_state(state)
    except HTTPException:
        raise
    except (OSError, RuntimeError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        logger.exception("Could not generate the protected automatic-backup key")
        raise HTTPException(
            status_code=503,
            detail="Não foi possível gerar e configurar a chave GPG protegida.",
        ) from exc
    emit_audit_event(
        principal,
        "management",
        "automatic_backup_key_generated",
        fingerprint,
        service="access",
    )
    return {"fingerprint": fingerprint}


@app.post("/api/v1/backup/automatic/private-key/export")
def export_automatic_backup_private_key(
    payload: AutomaticBackupKeyExportRequest,
    principal: Annotated[DemoPrincipal, AUTHENTICATED],
) -> Response:
    _require_admin(principal)
    try:
        fingerprint = _generated_private_key_fingerprint()
        if fingerprint is None:
            raise HTTPException(
                status_code=409,
                detail="Não há uma chave privada GPG gerada para exportar.",
            )
        home = _generated_gpg_home()
        try:
            exported = subprocess.run(
                [
                    "gpg",
                    "--batch",
                    "--homedir",
                    str(home),
                    "--pinentry-mode",
                    "loopback",
                    "--passphrase-fd",
                    "0",
                    "--armor",
                    "--export-secret-keys",
                    fingerprint,
                ],
                input=f"{payload.passphrase.get_secret_value()}\n".encode(),
                capture_output=True,
                check=True,
                timeout=30,
            ).stdout
        finally:
            _stop_generated_gpg_agent(home)
        if not exported.startswith(b"-----BEGIN PGP PRIVATE KEY BLOCK-----"):
            raise RuntimeError("A exportação não produziu uma chave privada protegida")
    except HTTPException:
        raise
    except (OSError, RuntimeError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        logger.exception("Could not export the protected automatic-backup private key")
        raise HTTPException(
            status_code=422,
            detail="Não foi possível exportar a chave privada. Confira a senha e tente novamente.",
        ) from exc
    emit_audit_event(
        principal,
        "management",
        "automatic_backup_private_key_exported",
        fingerprint,
        service="access",
    )
    return Response(
        content=exported,
        media_type="application/pgp-keys",
        headers={
            "Cache-Control": "no-store",
            "Content-Disposition": (
                f'attachment; filename="scpo-connect-backup-{fingerprint}.asc"'
            ),
        },
    )


@app.put("/api/v1/backup/automatic/config")
def configure_automatic_backup(
    payload: AutomaticBackupConfig,
    principal: Annotated[DemoPrincipal, AUTHENTICATED],
) -> dict[str, object]:
    _require_admin(principal)
    try:
        destination = _resolve_automatic_destination(payload.directory)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    state = _load_automatic_backup_state()
    if payload.encryption_type == "gpg":
        if not isinstance(state.get("recipient"), str):
            raise HTTPException(
                status_code=409,
                detail="Importe primeiro a chave pública GPG autorizada",
            )
        if not payload.fingerprint_confirmation or not hmac.compare_digest(
            str(state["recipient"]).upper(),
            payload.fingerprint_confirmation.upper(),
        ):
            raise HTTPException(
                status_code=422,
                detail="A impressão digital não corresponde à chave pública importada",
            )
    else:
        if payload.password is None and not isinstance(state.get("automatic_password"), dict):
            raise HTTPException(
                status_code=422,
                detail="Informe uma senha nova para proteger os backups automáticos",
            )
        if payload.password is not None:
            state["automatic_password"] = _store_automatic_password(
                payload.password.get_secret_value()
            )
    try:
        destination.mkdir(parents=True, exist_ok=True, mode=0o750)
    except OSError as exc:
        raise HTTPException(
            status_code=503,
            detail="A subpasta não pode ser criada no volume-base",
        ) from exc
    if not destination.is_dir() or not os.access(destination, os.W_OK):
        raise HTTPException(
            status_code=503,
            detail="A subpasta não está disponível para gravação",
        )
    state["directory"] = payload.directory
    schedule_values = payload.model_dump(
        exclude={"directory", "fingerprint_confirmation", "password"}
    )
    state.update(schedule_values)
    configured_at = datetime.now(UTC)
    if payload.schedule_type == "interval":
        timezone = ZoneInfo(os.getenv("SCPO_BACKUP_TIMEZONE", "America/Sao_Paulo"))
        now = configured_at.astimezone(timezone)
        anchor = _local_run_time(now.date(), payload.run_time, timezone)
        if anchor <= now:
            anchor = _local_run_time(now.date() + timedelta(days=1), payload.run_time, timezone)
        state["schedule_anchor_at"] = anchor.isoformat()
    else:
        state.pop("schedule_anchor_at", None)
    state["schedule_updated_at"] = configured_at.isoformat()
    state["last_error"] = None
    _save_automatic_backup_state(state)
    emit_audit_event(
        principal,
        "management",
        "automatic_backup_configured",
        payload.directory,
        service="access",
    )
    return _automatic_backup_status()


@app.get("/health")
def health() -> dict[str, str]:
    return {"service": "backup", "status": "ok"}


@app.post("/api/v1/backup/export")
def export_backup(payload: ExportRequest, principal: Annotated[DemoPrincipal, AUTHENTICATED]) -> Response:
    _require_admin(principal)
    try:
        content = _create_bundle(payload.password)
    except subprocess.CalledProcessError as exc:
        raise HTTPException(status_code=503, detail="Falha ao gerar o backup de um dos bancos") from exc
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=504, detail="Tempo excedido ao gerar o backup") from exc
    emit_audit_event(
        principal,
        "management",
        "system_backup_exported",
        "all_databases",
        service="access",
    )
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    return Response(
        content=content,
        media_type="application/vnd.scpo.rgs",
        headers={
            "Content-Disposition": f'attachment; filename="scpo-connect-{stamp}.rgs"',
            "Cache-Control": "no-store",
        },
    )


@app.get("/api/v1/backup/operations/{operation_id}")
def restore_operation_status(
    operation_id: UUID,
    principal: Annotated[DemoPrincipal, AUTHENTICATED],
) -> dict[str, object]:
    _require_admin(principal)
    operation = _read_restore_operation(str(operation_id))
    if operation is None:
        raise HTTPException(status_code=404, detail="A operação não existe ou o estado já expirou")
    return operation


@app.put("/api/v1/backup/restore")
async def restore_backup(
    request: Request,
    principal: Annotated[DemoPrincipal, AUTHENTICATED],
) -> dict[str, str]:
    _require_admin(principal)
    if request.headers.get("x-restore-confirmation") != RESTORE_CONFIRMATION:
        raise HTTPException(status_code=422, detail=f"Digite exatamente: {RESTORE_CONFIRMATION}")
    if request.headers.get("content-type", "").split(";", 1)[0] not in {
        "application/vnd.scpo.rgs",
        "application/octet-stream",
    }:
        raise HTTPException(status_code=415, detail="Envie um arquivo de backup .rgs")

    password = _restore_password(request)
    operation_id = _parse_restore_operation_id(request)
    if not RESTORE_LOCK.acquire(blocking=False):
        _update_restore_operation(
            operation_id,
            status="failed",
            stage="rejected",
            message="Já existe uma restauração em andamento.",
            progress=None,
        )
        raise HTTPException(status_code=409, detail="Já existe uma restauração em andamento")

    _update_restore_operation(
        operation_id,
        status="running",
        stage="receiving",
        message="Recebendo o arquivo .rgs; mantenha esta tela aberta.",
        progress=0,
    )
    try:
        with tempfile.TemporaryDirectory(prefix="scpo-rgs-restore-") as temp:
            root = Path(temp)
            source = root / "backup.rgs"
            dumps = root / "dumps"
            await _save_upload(request, source)
            with source.open("rb") as uploaded:
                is_password_bundle = uploaded.read(len(MAGIC)) == MAGIC
            if not is_password_bundle:
                raise HTTPException(
                    status_code=422,
                    detail=(
                        "Este arquivo não é um backup AES-GCM com senha exportado pela "
                        "interface. Backups automáticos GPG devem ser verificados e "
                        "restaurados em ambiente isolado com a chave privada custodiada "
                        "separadamente; se este era um backup manual, confira o arquivo."
                    ),
                )
            _update_restore_operation(
                operation_id,
                status="running",
                stage="decrypting",
                message="Descriptografando o pacote e conferindo o manifesto.",
                progress=5,
            )
            try:
                await asyncio.to_thread(
                    decrypt_and_extract,
                    source,
                    dumps,
                    password=password,
                )
                total = len(DATABASES)
                _update_restore_operation(
                    operation_id,
                    status="running",
                    stage="validating",
                    message="Validando os sete bancos antes de alterar os dados atuais.",
                    progress=10,
                )
                for index, service in enumerate(DATABASES, start=1):
                    await asyncio.to_thread(
                        _validate_database_dump,
                        dumps / f"{service}.dump",
                    )
                    progress = 10 + round(index / total * 20)
                    _update_restore_operation(
                        operation_id,
                        status="running",
                        stage="validating",
                        message=f"Banco {service} validado ({index}/{total}).",
                        progress=progress,
                    )
            except (InvalidTag, OSError, ValueError, tarfile.TarError, subprocess.SubprocessError) as exc:
                raise HTTPException(
                    status_code=422,
                    detail="Arquivo .rgs inválido, senha incorreta, dump PostgreSQL incompatível ou backup danificado; nenhum banco foi alterado",
                ) from exc

            _update_restore_operation(
                operation_id,
                status="running",
                stage="snapshotting",
                message="Criando cópias temporárias dos dados atuais para recuperação.",
                progress=30,
            )

            def report_restore_progress(stage: str, completed: int, total: int) -> None:
                if stage == "snapshot":
                    progress = 30 + round(completed / total * 25)
                    message = f"Cópia temporária criada ({completed}/{total})."
                    operation_stage = "snapshotting"
                elif stage == "restore_started":
                    progress = 55 + round((completed - 1) / total * 44)
                    message = f"Restaurando banco {DATABASES[completed - 1]} ({completed}/{total})."
                    operation_stage = "restoring"
                else:
                    progress = 55 + round(completed / total * 44)
                    message = f"Banco {DATABASES[completed - 1]} restaurado ({completed}/{total})."
                    operation_stage = "restoring"
                _update_restore_operation(
                    operation_id,
                    status="running",
                    stage=operation_stage,
                    message=message,
                    progress=progress,
                )

            _update_restore_operation(
                operation_id,
                status="running",
                stage="restoring",
                message="As cópias temporárias estão prontas. Restaurando os sete bancos.",
                progress=55,
            )
            try:
                await asyncio.to_thread(
                    _restore_all_databases,
                    dumps,
                    report_restore_progress,
                )
            except RuntimeError as exc:
                logger.exception("Backup restore and rollback failed")
                raise HTTPException(status_code=500, detail=str(exc)) from exc
            except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
                logger.exception("Backup restore failed; automatic rollback succeeded")
                raise HTTPException(
                    status_code=503,
                    detail="A restauração falhou. Os dados anteriores foram recuperados automaticamente.",
                ) from exc

        emit_audit_event(
            principal,
            "management",
            "system_backup_restored",
            "all_databases",
            service="access",
        )
        _update_restore_operation(
            operation_id,
            status="completed",
            stage="completed",
            message="Os sete bancos foram restaurados com sucesso.",
            progress=100,
        )
        return {"status": "restored", "message": "Os sete bancos foram restaurados com sucesso."}
    except HTTPException as exc:
        _update_restore_operation(
            operation_id,
            status="failed",
            stage="failed",
            message=str(exc.detail),
            progress=None,
        )
        raise
    finally:
        operation = _read_restore_operation(operation_id) if operation_id else None
        if operation is not None and operation.get("status") == "running":
            _update_restore_operation(
                operation_id,
                status="failed",
                stage="failed",
                message=(
                    "A restauração foi interrompida antes da conclusão. Confira o estado "
                    "dos serviços antes de iniciar outra operação."
                ),
                progress=None,
            )
        RESTORE_LOCK.release()
