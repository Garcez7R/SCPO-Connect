#!/usr/bin/env bash
set -euo pipefail
umask 077

: "${SCPO_RGS_FILE:?Defina SCPO_RGS_FILE com o arquivo .rgs}"
: "${SCPO_RGS_WORK_DIR:?Defina um diretório de trabalho seguro fora do repositório}"
: "${SCPO_RGS_RESTORE_PREFIX:?Defina um prefixo novo, por exemplo scpo_restore_20261015}"
[[ -f "$SCPO_RGS_FILE" && "$SCPO_RGS_FILE" == *.rgs ]] || { printf 'Informe um arquivo .rgs existente.\n' >&2; exit 1; }
[[ "$SCPO_RGS_RESTORE_PREFIX" =~ ^scpo_restore_[a-zA-Z0-9_]{1,30}$ ]] || { printf 'O prefixo deve iniciar com scpo_restore_ e usar apenas letras, números e _.\n' >&2; exit 1; }

workspace="$(pwd -P)"
workdir="$(realpath -m "$SCPO_RGS_WORK_DIR")"
[[ "$workdir" = /* ]] || { printf 'SCPO_RGS_WORK_DIR deve ser absoluto.\n' >&2; exit 1; }
case "$workdir/" in "$workspace/"*) printf 'A restauração temporária deve ficar fora do repositório.\n' >&2; exit 1 ;; esac
mkdir -p "$workdir"
staging="$(mktemp -d "$workdir/.rgs-restore.XXXXXX")"
trap 'rm -rf "$staging"' EXIT
PYTHONPATH="$workspace/backend" uv run --project "$workspace" python -m scpo_services.rgs_format "$SCPO_RGS_FILE" "$staging/dumps"
databases=(scpo_access scpo_audit scpo_nursing scpo_pharmacy scpo_social scpo_xray scpo_maintenance)
for database in "${databases[@]}"; do
  dump="$staging/dumps/${database#scpo_}.dump"
  [[ -f "$dump" ]] || { printf 'Dump ausente: %s\n' "$database" >&2; exit 1; }
  target="${SCPO_RGS_RESTORE_PREFIX}_${database#scpo_}"
  docker compose exec -T db sh -c "createdb -U \"\$POSTGRES_USER\" $target"
  docker compose exec -T -i db sh -c "pg_restore -U \"\$POSTGRES_USER\" --no-owner --no-privileges --dbname=$target" < "$dump"
  printf 'Cópia isolada restaurada: %s\n' "$target"
done
printf 'Restauração concluída em bancos novos. O app permanece ligado aos bancos originais.\n'
