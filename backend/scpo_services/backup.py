"""Administrator-only encrypted full database exports using the .rgs format."""

import base64
import binascii
import io
import json
import logging
import os
import secrets
import subprocess
import tarfile
import tempfile
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated
from urllib.parse import unquote, urlparse

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

from .common import DemoPrincipal, authenticated_principal, emit_audit_event
from .rgs_format import DATABASES, MAGIC, decrypt_and_extract

app = FastAPI(title="SCPO Connect · Backup", version="1.0.0")
AUTHENTICATED = Depends(authenticated_principal)
RESTORE_CONFIRMATION = "SUBSTITUIR TODOS OS DADOS"
RESTORE_LOCK = threading.Lock()
logger = logging.getLogger(__name__)


class ExportRequest(BaseModel):
    password: str = Field(min_length=12, max_length=128)


def _require_admin(principal: DemoPrincipal) -> None:
    if not principal.is_superuser:
        raise HTTPException(status_code=403, detail="Somente o superadministrador do sistema pode exportar backups")


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
                    detail="A restauração pela interface aceita backups .rgs protegidos por senha",
                )
            try:
                decrypt_and_extract(source, dumps, password=password)
                for service in DATABASES:
                    _validate_database_dump(dumps / f"{service}.dump")
            except (InvalidTag, OSError, ValueError, tarfile.TarError, subprocess.SubprocessError) as exc:
                raise HTTPException(
                    status_code=422,
                    detail="Backup inválido, senha incorreta ou arquivo danificado; nenhum banco foi alterado",
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
