"""Administrator-only encrypted full database exports using the .rgs format."""

import asyncio
import base64
import binascii
import hmac
import io
import json
import logging
import os
import secrets
import shutil
import subprocess
import tarfile
import tempfile
import threading
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path, PurePosixPath
from typing import Annotated
from urllib.parse import unquote, urlparse
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field

from .common import DemoPrincipal, authenticated_principal, emit_audit_event
from .rgs_format import DATABASES, MAGIC, decrypt_and_extract

AUTHENTICATED = Depends(authenticated_principal)
RESTORE_CONFIRMATION = "SUBSTITUIR TODOS OS DADOS"
RESTORE_LOCK = threading.Lock()
AUTO_BACKUP_LOCK = threading.Lock()
AUTO_BACKUP_RETENTION_DAYS = 30
AUTO_BACKUP_HOUR = 2
LOW_DISK_SPACE_FRACTION = 0.1
MAX_PUBLIC_KEY_BYTES = 64 * 1024
logger = logging.getLogger(__name__)


class ExportRequest(BaseModel):
    password: str = Field(min_length=12, max_length=128)


class AutomaticBackupConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    directory: str = Field(min_length=1, max_length=200)
    fingerprint_confirmation: str = Field(
        min_length=40,
        max_length=64,
        pattern=r"^(?:[A-Fa-f0-9]{40}|[A-Fa-f0-9]{64})$",
    )


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


def _automatic_backup_status() -> dict[str, object]:
    state = _load_automatic_backup_state()
    directory = state.get("directory")
    recipient = state.get("recipient")
    configured = isinstance(directory, str) and isinstance(recipient, str)
    destination = _resolve_automatic_destination(directory) if configured else None
    base = _backup_data_dir()
    base_available = base.is_dir() and os.access(base, os.W_OK)
    destination_available = bool(
        destination and destination.is_dir() and os.access(destination, os.W_OK)
    )
    disk_path = destination or base
    disk = shutil.disk_usage(disk_path) if disk_path.exists() else None
    free_bytes = disk.free if disk else None
    low_space = bool(
        disk and disk.total > 0 and disk.free / disk.total < LOW_DISK_SPACE_FRACTION
    )
    timezone_name = os.getenv("SCPO_BACKUP_TIMEZONE", "America/Sao_Paulo")
    timezone = ZoneInfo(timezone_name)
    now = datetime.now(timezone)
    next_run = now.replace(hour=AUTO_BACKUP_HOUR, minute=0, second=0, microsecond=0)
    if now >= next_run:
        if configured and state.get("last_success_date") != now.date().isoformat():
            next_run = now.replace(second=0, microsecond=0) + timedelta(minutes=1)
            last_attempt = state.get("last_attempt_at")
            if isinstance(last_attempt, str):
                try:
                    attempt_time = datetime.fromisoformat(last_attempt)
                    if attempt_time.tzinfo is None:
                        attempt_time = attempt_time.replace(tzinfo=UTC)
                    next_run = max(
                        next_run,
                        attempt_time.astimezone(timezone) + timedelta(hours=1),
                    )
                except ValueError as exc:
                    raise RuntimeError("Data da última tentativa de backup está inválida") from exc
        else:
            next_run += timedelta(days=1)
    return {
        "enabled": configured and base_available and destination_available,
        "configured": configured,
        "base_volume_available": base_available,
        "destination_available": destination_available,
        "destination_directory": directory if configured else None,
        "recipient_configured": bool(recipient),
        "recipient_fingerprint": recipient,
        "schedule": f"Diariamente às {AUTO_BACKUP_HOUR:02d}:00 ({timezone_name})",
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


def _prune_automatic_backups(destination: Path, now: datetime | None = None) -> int:
    cutoff = (now or datetime.now(UTC)) - timedelta(days=AUTO_BACKUP_RETENTION_DAYS)
    removed = 0
    for backup in destination.glob("scpo-connect-*.rgs"):
        if backup.is_symlink() or not backup.is_file():
            continue
        modified_at = datetime.fromtimestamp(backup.stat().st_mtime, UTC)
        if modified_at < cutoff:
            backup.unlink()
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


def _create_automatic_backup() -> Path:
    state = _load_automatic_backup_state()
    directory = state.get("directory")
    recipient = state.get("recipient")
    if not isinstance(directory, str) or not isinstance(recipient, str):
        raise TypeError("Configure o destino e a chave pública antes de ativar backups")
    destination = _resolve_automatic_destination(directory)
    if not destination.is_dir() or not os.access(destination, os.W_OK):
        raise RuntimeError("A subpasta de backup não está disponível para gravação")
    env_file = Path(os.getenv("SCPO_BACKUP_ENV_FILE", "/run/secrets/scpo-env"))
    caddy_directory = Path(os.getenv("SCPO_BACKUP_CADDY_DIR", "/mnt/caddy-data"))
    therapy_directory = Path(
        os.getenv("SCPO_BACKUP_THERAPY_DIR", "/mnt/therapy-materials")
    )
    if not env_file.is_file() or env_file.is_symlink():
        raise RuntimeError("O arquivo .env não está disponível para backup")
    if not _gpg_home().is_dir():
        raise RuntimeError("A chave pública GPG configurada não está disponível")

    _prune_automatic_backups(destination)
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
            "Formato: RGS v1 (GPG)\n"
            f"Criado em UTC: {timestamp}\n"
            f"Bancos: {' '.join(databases)}\n"
            "Anexos: .env, autoridade Caddy e biblioteca da Oficina Terapêutica\n"
            f"Arquivos Caddy: {caddy_count}; arquivos da Oficina: {therapy_count}\n"
            "Contém dados pessoais e clínicos protegidos por chave pública GPG.\n"
        )
        (staging / "MANIFEST.txt").write_text(manifest, encoding="utf-8")
        archive_path = staging / "bundle.tar.gz"
        with tarfile.open(archive_path, mode="w:gz") as archive:
            for path in sorted(staging.iterdir()):
                if path != archive_path:
                    archive.add(path, arcname=path.relative_to(staging).as_posix())
        encrypted_path = staging / "bundle.rgs"
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
                recipient,
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
    return backup_path


def _should_run_automatic_backup(
    state: dict[str, object],
    now: datetime,
    timezone: ZoneInfo,
) -> bool:
    if not isinstance(state.get("directory"), str) or not isinstance(
        state.get("recipient"), str
    ):
        return False
    local_now = now.astimezone(timezone)
    if local_now.hour < AUTO_BACKUP_HOUR:
        return False
    today = local_now.date().isoformat()
    if state.get("last_success_date") == today:
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
                    state["last_attempt_at"] = now.isoformat()
                    state["last_error"] = None
                    _save_automatic_backup_state(state)
                    backup_path = await asyncio.to_thread(_create_automatic_backup)
                    state = _load_automatic_backup_state()
                    state["last_success_at"] = datetime.now(UTC).isoformat()
                    state["last_success_date"] = now.astimezone(timezone).date().isoformat()
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


def _restore_all_databases(dumps_dir: Path) -> None:
    restored: list[str] = []
    with tempfile.TemporaryDirectory(prefix="scpo-restore-safety-") as safety_dir:
        safety_path = Path(safety_dir)
        try:
            for service in DATABASES:
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
            for service in DATABASES:
                _restore_database(service, dumps_dir / f"{service}.dump")
                restored.append(service)
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
    if not isinstance(state.get("recipient"), str):
        raise HTTPException(
            status_code=409,
            detail="Importe primeiro a chave pública GPG autorizada",
        )
    if not hmac.compare_digest(
        str(state["recipient"]).upper(),
        payload.fingerprint_confirmation.upper(),
    ):
        raise HTTPException(
            status_code=422,
            detail="A impressão digital não corresponde à chave pública importada",
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
    if not RESTORE_LOCK.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="Já existe uma restauração em andamento")

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
            try:
                decrypt_and_extract(source, dumps, password=password)
                for service in DATABASES:
                    _validate_database_dump(dumps / f"{service}.dump")
            except (InvalidTag, OSError, ValueError, tarfile.TarError, subprocess.SubprocessError) as exc:
                raise HTTPException(
                    status_code=422,
                    detail="Arquivo .rgs inválido, senha incorreta, dump PostgreSQL incompatível ou backup danificado; nenhum banco foi alterado",
                ) from exc
            try:
                _restore_all_databases(dumps)
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
        return {"status": "restored", "message": "Os sete bancos foram restaurados com sucesso."}
    finally:
        RESTORE_LOCK.release()
