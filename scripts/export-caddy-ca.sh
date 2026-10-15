#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

# Export only Caddy's public root certificate. Never export its private key.
export_path="${SCPO_CERT_EXPORT_PATH:-$project_dir/data/local/scpo-local-root.crt}"
mkdir -p "$(dirname "$export_path")"
sudo docker compose cp \
  proxy:/data/caddy/pki/authorities/local/root.crt \
  "$export_path"
sudo chown "$(id -u):$(id -g)" "$export_path"
chmod 0644 "$export_path"

openssl x509 -in "$export_path" -noout -subject -fingerprint -sha256
printf '\nCA pública exportada em %s\n' "$export_path"
printf 'Transfira o arquivo por canal administrado pela instituição e confira a impressão digital por canal independente antes de confiar nele.\n'
