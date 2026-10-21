#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
LOCAL_DATA_DIR="${SCPO_LOCAL_DATA_DIR:-$PWD/data/demo}"
if [[ "$LOCAL_DATA_DIR" != /* ]]; then
  LOCAL_DATA_DIR="$PWD/$LOCAL_DATA_DIR"
fi
mkdir -p .logs "$LOCAL_DATA_DIR"
export SCPO_ENV="${SCPO_ENV:-development}"
export PYTHONPATH="$PWD/backend${PYTHONPATH:+:$PYTHONPATH}"
export UV_CACHE_DIR="$PWD/data/uv-cache"
export SCPO_SERVICE_TOKEN="${SCPO_SERVICE_TOKEN:-$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')}"
export SCPO_AUDIT_API_URL="${SCPO_AUDIT_API_URL:-http://127.0.0.1:8006}"
export SCPO_ACCESS_API_URL="${SCPO_ACCESS_API_URL:-http://127.0.0.1:8002}"
export SCPO_NURSING_API_URL="${SCPO_NURSING_API_URL:-http://127.0.0.1:8001}"
export SCPO_PHARMACY_API_URL="${SCPO_PHARMACY_API_URL:-http://127.0.0.1:8003}"
export SCPO_COOKIE_SECURE="${SCPO_COOKIE_SECURE:-false}"
auth_keys_file="$LOCAL_DATA_DIR/auth.keys.env"
if [[ ! -f "$auth_keys_file" ]]; then
  python3 - "$auth_keys_file" "$PWD/.env" "$LOCAL_DATA_DIR/bootstrap-admin.token" <<'PY'
from pathlib import Path
import os
import secrets
import sys
path, env_path, bootstrap_path = map(Path, sys.argv[1:])
file_values = {}
if env_path.exists():
    for line in env_path.read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            file_values[key] = value
values = {}
for key in ("SCPO_SESSION_SIGNING_KEY", "SCPO_MFA_ENCRYPTION_KEY", "SCPO_BOOTSTRAP_ADMIN_TOKEN"):
    current = bootstrap_path.read_text().strip() if key == "SCPO_BOOTSTRAP_ADMIN_TOKEN" and bootstrap_path.exists() else ""
    values[key] = os.environ.get(key) or current or file_values.get(key) or secrets.token_urlsafe(32)
path.write_text("\n".join(f"{key}={values[key]}" for key in values) + "\n")
path.chmod(0o600)
PY
fi
set -a
source "$auth_keys_file"
set +a
bootstrap_token_file="$LOCAL_DATA_DIR/bootstrap-admin.token"
printf '%s\n' "$SCPO_BOOTSTRAP_ADMIN_TOKEN" > "$bootstrap_token_file"
chmod 0600 "$bootstrap_token_file"
API_BIND_HOST="${SCPO_API_BIND_HOST:-127.0.0.1}"

for service in access audit nursing pharmacy social xray maintenance; do
  database_variable="SCPO_${service^^}_DATABASE_URL"
  export "$database_variable=sqlite:///$LOCAL_DATA_DIR/${service}.sqlite3"
  SCPO_SERVICE="$service" uv run --no-sync alembic upgrade head
done

pids=()
start_service() {
  local service="$1"
  local port="$2"
  uv run --no-sync uvicorn "scpo_services.${service}:app" --host "$API_BIND_HOST" --port "$port" >".logs/${service}.log" 2>&1 &
  pids+=("$!")
  printf 'API %-9s http://127.0.0.1:%s/docs\n' "$service" "$port"
}

start_service nursing 8001
start_service access 8002
start_service pharmacy 8003
start_service xray 8004
start_service social 8005
start_service audit 8006
start_service maintenance 8007
start_service therapy 8008
start_service backup 8009
printf '\nAPIs em execução. Ctrl+C encerra todos os serviços. Logs em .logs/\n'

cleanup() {
  kill "${pids[@]}" 2>/dev/null || true
  wait "${pids[@]}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM
wait -n "${pids[@]}"
