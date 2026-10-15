#!/usr/bin/env bash
set -euo pipefail

: "${SCPO_RESTORE_FILE:?Defina o arquivo de backup criptografado}"
: "${SCPO_RESTORE_KIND:?Defina SCPO_RESTORE_KIND=database ou caddy-data}"
: "${SCPO_RESTORE_DEMO_ONLY:?Confirme explicitamente SCPO_RESTORE_DEMO_ONLY=yes}"

if [[ "$SCPO_RESTORE_DEMO_ONLY" != "yes" ]]; then
  printf 'A restauração de exemplo aceita somente a confirmação literal yes.\n' >&2
  exit 1
fi
if [[ ! -f "$SCPO_RESTORE_FILE" ]]; then
  printf 'Arquivo de backup não encontrado.\n' >&2
  exit 1
fi

temporary="$(mktemp)"
trap 'rm -f "$temporary"' EXIT
gpg --batch --decrypt --output "$temporary" "$SCPO_RESTORE_FILE"

if [[ "$SCPO_RESTORE_KIND" == "database" ]]; then
  : "${SCPO_RESTORE_DATABASE:?Defina o banco de destino do backup}"
  : "${SCPO_RESTORE_NEW_DATABASE:?Defina um nome de banco novo para restauração}"
  case "$SCPO_RESTORE_DATABASE" in
    scpo_access|scpo_audit|scpo_nursing|scpo_pharmacy|scpo_social|scpo_xray) ;;
    *) printf 'Banco de origem fora da lista de demonstração.\n' >&2; exit 1 ;;
  esac
  if [[ ! "$SCPO_RESTORE_NEW_DATABASE" =~ ^scpo_restore_demo_[a-z0-9_]+$ ]]; then
    printf 'O banco novo deve usar o prefixo scpo_restore_demo_.\n' >&2
    exit 1
  fi
  exists="$(docker compose exec -T db sh -c "psql -U \"\$POSTGRES_USER\" -d postgres -Atqc \"SELECT 1 FROM pg_database WHERE datname='${SCPO_RESTORE_NEW_DATABASE}'\"")"
  if [[ -n "$exists" ]]; then
    printf 'O banco de destino já existe; nada foi sobrescrito.\n' >&2
    exit 1
  fi
  docker compose exec -T db sh -c "createdb -U \"\$POSTGRES_USER\" '${SCPO_RESTORE_NEW_DATABASE}'"
  docker compose exec -T db sh -c "pg_restore -U \"\$POSTGRES_USER\" --no-owner --no-acl --dbname='${SCPO_RESTORE_NEW_DATABASE}'" < "$temporary"
  printf 'Backup restaurado em banco novo: %s\n' "$SCPO_RESTORE_NEW_DATABASE"
elif [[ "$SCPO_RESTORE_KIND" == "caddy-data" ]]; then
  restore_volume="scpo_caddy_restore_$(date -u +%Y%m%d%H%M%S)"
  if docker volume inspect "$restore_volume" >/dev/null 2>&1; then
    printf 'O volume de destino já existe; nada foi sobrescrito.\n' >&2
    exit 1
  fi
  docker volume create "$restore_volume" >/dev/null
  docker run --rm -i -v "${restore_volume}:/restore" alpine:3.22 tar -C /restore -xzf - < "$temporary"
  printf 'Estado do Caddy restaurado em volume novo: %s\n' "$restore_volume"
  printf 'Valide o volume restaurado antes de alterar a implantação.\n'
else
  printf 'SCPO_RESTORE_KIND deve ser database ou caddy-data.\n' >&2
  exit 1
fi