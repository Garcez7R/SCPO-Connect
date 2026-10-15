#!/usr/bin/env bash
set -euo pipefail
umask 077

: "${SCPO_BACKUP_DIR:?Defina SCPO_BACKUP_DIR para um diretório seguro fora do repositório}"
: "${SCPO_BACKUP_GPG_RECIPIENT:?Defina o destinatário GPG autorizado}"
[[ "$SCPO_BACKUP_DIR" = /* ]] || { printf 'SCPO_BACKUP_DIR deve ser absoluto.\n' >&2; exit 1; }

workspace="$(pwd -P)"
destination_dir="$(realpath -m "$SCPO_BACKUP_DIR")"
case "$destination_dir/" in "$workspace/"*) printf 'Guarde backups fora do repositório.\n' >&2; exit 1 ;; esac
mkdir -p "$destination_dir"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
bundle="$destination_dir/scpo-connect-$stamp.rgs"
[[ ! -e "$bundle" ]] || { printf 'O arquivo já existe; nada foi substituído.\n' >&2; exit 1; }
staging="$(mktemp -d "$destination_dir/.rgs-staging.XXXXXX")"
trap 'rm -rf "$staging"' EXIT
mkdir -m 700 "$staging/dumps"

databases=(scpo_access scpo_audit scpo_nursing scpo_pharmacy scpo_social scpo_xray scpo_maintenance)
for database in "${databases[@]}"; do
  docker compose exec -T db sh -c "pg_dump -U \"\$POSTGRES_USER\" --dbname=$database --format=custom" > "$staging/dumps/$database.dump"
done
{
  printf 'SCPO Connect backup\nFormato: RGS v1 (GPG)\nCriado em UTC: %s\n' "$stamp"
  printf 'Bancos: %s\n' "${databases[*]}"
  printf 'Contém usuários locais, permissões e dados dos módulos.\n'
} > "$staging/MANIFEST.txt"
tar -C "$staging" -czf "$staging/bundle.tar.gz" MANIFEST.txt dumps
gpg --batch --encrypt --recipient "$SCPO_BACKUP_GPG_RECIPIENT" --output "$bundle" "$staging/bundle.tar.gz"
chmod 600 "$bundle"
printf 'Backup cifrado criado: %s\n' "$bundle"
