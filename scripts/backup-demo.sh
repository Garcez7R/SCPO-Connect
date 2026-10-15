#!/usr/bin/env bash
set -euo pipefail

: "${SCPO_BACKUP_DIR:?Defina SCPO_BACKUP_DIR como destino fora do servidor}"
: "${SCPO_BACKUP_GPG_RECIPIENT:?Defina o destinatário da chave pública GPG}"
: "${SCPO_BACKUP_DEMO_ONLY:?Confirme explicitamente SCPO_BACKUP_DEMO_ONLY=yes}"

if [[ "$SCPO_BACKUP_DEMO_ONLY" != "yes" ]]; then
  printf 'Este script aceita apenas a confirmação literal yes para dados fictícios.\n' >&2
  exit 1
fi
if [[ "$SCPO_BACKUP_DIR" != /* ]]; then
  printf 'SCPO_BACKUP_DIR deve ser um caminho absoluto.\n' >&2
  exit 1
fi

workspace="$(pwd -P)"
backup_path="$(realpath -m "$SCPO_BACKUP_DIR")"
case "$backup_path/" in
  "$workspace/"*) printf 'O destino de backup deve ficar fora do repositório.\n' >&2; exit 1 ;;
esac

mkdir -p "$backup_path"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
temporary="$(mktemp)"
trap 'rm -f "$temporary"' EXIT

for database in scpo_access scpo_audit scpo_nursing scpo_pharmacy scpo_social scpo_xray; do
  destination="$backup_path/${database}_${stamp}.dump.gpg"
  if [[ -e "$destination" ]]; then
    printf 'Backup existente; nenhum arquivo foi substituído: %s\n' "$destination" >&2
    exit 1
  fi
  docker compose exec -T db sh -c "pg_dump -U \"\$POSTGRES_USER\" --dbname=${database} --format=custom" > "$temporary"
  gpg --batch --encrypt --recipient "$SCPO_BACKUP_GPG_RECIPIENT" --output "$destination" "$temporary"
  rm -f "$temporary"
  temporary="$(mktemp)"
  printf 'Backup criptografado: %s\n' "$destination"
done

destination="$backup_path/caddy_data_${stamp}.tar.gz.gpg"
if [[ -e "$destination" ]]; then
  printf 'Backup existente; nenhum arquivo foi substituído: %s\n' "$destination" >&2
  exit 1
fi
docker compose exec -T proxy tar -C /data -czf - . > "$temporary"
gpg --batch --encrypt --recipient "$SCPO_BACKUP_GPG_RECIPIENT" --output "$destination" "$temporary"
printf 'Estado persistente do proxy criptografado: %s\n' "$destination"