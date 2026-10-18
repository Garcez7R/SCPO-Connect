"""Administrator-only encrypted full database exports using the .rgs format."""

import io
import json
import os
import secrets
import subprocess
import tarfile
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated
from urllib.parse import unquote, urlparse

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from .common import DemoPrincipal, authenticated_principal, emit_audit_event
from .rgs_format import MAGIC

DATABASES = ("access", "audit", "nursing", "pharmacy", "social", "xray", "maintenance")
app = FastAPI(title="SCPO Connect · Backup", version="1.0.0")
AUTHENTICATED = Depends(authenticated_principal)


class ExportRequest(BaseModel):
    password: str = Field(min_length=12, max_length=128)


def _require_admin(principal: DemoPrincipal) -> None:
    if not principal.is_superuser:
        raise HTTPException(status_code=403, detail="Somente o superadministrador do sistema pode exportar backups")


def _connection_args(service: str) -> tuple[list[str], dict[str, str]]:
    parsed = urlparse(os.getenv(f"SCPO_{service.upper()}_DATABASE_URL", ""))
    if parsed.scheme not in {"postgres", "postgresql", "postgresql+psycopg"} or not parsed.hostname:
        raise HTTPException(status_code=503, detail=f"Banco de {service} não está configurado para backup")
    args = ["-h", parsed.hostname, "-p", str(parsed.port or 5432), "-U", unquote(parsed.username or ""), "-d", parsed.path.lstrip("/")]
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
                subprocess.run(["pg_dump", *args, "--format=custom", "--no-owner", "--no-privileges"], env=env, stdout=output, stderr=subprocess.PIPE, check=True, timeout=900)
        content = io.BytesIO()
        with tarfile.open(fileobj=content, mode="w:gz") as archive:
            for path in root.iterdir():
                archive.add(path, arcname=path.name)
        return _encrypt(content.getvalue(), password)


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
    return Response(content=content, media_type="application/vnd.scpo.rgs", headers={"Content-Disposition": f'attachment; filename="scpo-connect-{stamp}.rgs"', "Cache-Control": "no-store"})
