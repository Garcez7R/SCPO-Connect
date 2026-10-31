#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly docker_repository="https://download.docker.com/linux/debian"
readonly required_api_services=(access audit nursing pharmacy social xray maintenance therapy backup)

fail() {
  printf 'ERRO: %s\n' "$*" >&2
  exit 1
}

if [[ "${EUID}" -ne 0 ]]; then
  fail "Execute com sudo: sudo bash scripts/install-server-debian13.sh"
fi

if [[ ! -f "${project_dir}/docker-compose.yml" || ! -f "${project_dir}/.env.example" ]]; then
  fail "Execute este script a partir de uma cópia completa do repositório."
fi

if [[ ! -f /etc/os-release ]]; then
  fail "Não foi possível identificar o sistema operacional."
fi

# shellcheck disable=SC1091
source /etc/os-release
if [[ "${ID:-}" != "debian" || ! "${VERSION_ID:-}" =~ ^13(\.|$) ]]; then
  fail "Sistema não suportado. Este instalador atende Debian 13."
fi

command -v apt-get >/dev/null 2>&1 || fail "apt-get não está disponível."
command -v systemctl >/dev/null 2>&1 || fail "systemd é necessário para iniciar o Docker."

cd "${project_dir}"
deployment_user="${SUDO_USER:-root}"
if [[ "${deployment_user}" != "root" ]] && id "${deployment_user}" >/dev/null 2>&1; then
  deployment_group="$(id -gn "${deployment_user}")"
else
  deployment_user=root
  deployment_group=root
fi

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  for package in docker.io docker-compose podman-docker containerd runc; do
    if dpkg-query -W -f='${db:Status-Abbrev}' "${package}" 2>/dev/null | grep -q '^ii'; then
      fail "O pacote conflitante ${package} está instalado. Remova-o após avaliar os serviços que dependem dele e execute novamente."
    fi
  done

  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y ca-certificates curl git gnupg openssl

  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "${docker_repository}/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] %s %s stable\n' \
    "$(dpkg --print-architecture)" \
    "${docker_repository}" \
    "${VERSION_CODENAME:?Não foi possível identificar o codinome Debian}" \
    > /etc/apt/sources.list.d/docker.list

  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

command -v curl >/dev/null 2>&1 || fail "curl não está instalado."
command -v openssl >/dev/null 2>&1 || fail "openssl não está instalado."
systemctl enable --now docker
docker info >/dev/null 2>&1 || fail "O daemon Docker não respondeu após a inicialização."

created_env=false
bootstrap_token_generated=false
temporary_env="${project_dir}/.env.install.$$"
trap 'rm -f "${temporary_env:-}"' EXIT

if [[ ! -e "${project_dir}/.env" ]]; then
  cp "${project_dir}/.env.example" "${temporary_env}"
  created_env=true
else
  cp "${project_dir}/.env" "${temporary_env}"
fi

set_env_value() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=" "${temporary_env}"; then
    sed -i "s|^${key}=.*$|${key}=${value}|" "${temporary_env}"
  else
    printf '%s=%s\n' "${key}" "${value}" >> "${temporary_env}"
  fi
}

ensure_env_value() {
  local key="$1"
  local value="$2"
  if ! grep -Eq "^${key}=.+$" "${temporary_env}"; then
    set_env_value "${key}" "${value}"
  fi
}

ensure_random_env_value() {
  local key="$1"
  if ! grep -Eq "^${key}=.+$" "${temporary_env}"; then
    set_env_value "${key}" "$(openssl rand -hex 32)"
  fi
}

ensure_urlsafe_env_value() {
  local key="$1"
  if ! grep -Eq "^${key}=.+$" "${temporary_env}"; then
    set_env_value "${key}" \
      "$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n')"
  fi
}

missing_required_secret=false
for key in \
  POSTGRES_PASSWORD SCPO_SERVICE_TOKEN SCPO_SESSION_SIGNING_KEY \
  SCPO_MFA_ENCRYPTION_KEY SCPO_BOOTSTRAP_ADMIN_TOKEN \
  SCPO_ACCESS_DB_PASSWORD SCPO_AUDIT_DB_PASSWORD SCPO_NURSING_DB_PASSWORD \
  SCPO_PHARMACY_DB_PASSWORD SCPO_SOCIAL_DB_PASSWORD SCPO_XRAY_DB_PASSWORD \
  SCPO_MAINTENANCE_DB_PASSWORD; do
  if ! grep -Eq "^${key}=.+$" "${temporary_env}"; then
    missing_required_secret=true
    break
  fi
done

if [[ "${created_env}" == "true" ]] \
  || ! grep -Eq '^SCPO_INTERNAL_HOST=.+$' "${temporary_env}" \
  || { [[ "${missing_required_secret}" == "true" ]] \
    && grep -qx 'SCPO_INTERNAL_HOST=localhost' "${temporary_env}"; }; then
  read -r -p "IP ou DNS estável que será usado para acessar este servidor: " internal_host \
    || fail "Não foi possível ler o endereço do servidor."
  if [[ ! "${internal_host}" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*$ || "${internal_host}" == *..* ]]; then
    fail "Informe um endereço IPv4 ou nome DNS simples, sem protocolo, porta ou caminho."
  fi
  set_env_value SCPO_INTERNAL_HOST "${internal_host}"
fi

ensure_env_value POSTGRES_USER scpo_admin
ensure_env_value SCPO_ACCESS_DB_USER scpo_access_user
ensure_env_value SCPO_AUDIT_DB_USER scpo_audit_user
ensure_env_value SCPO_NURSING_DB_USER scpo_nursing_user
ensure_env_value SCPO_PHARMACY_DB_USER scpo_pharmacy_user
ensure_env_value SCPO_SOCIAL_DB_USER scpo_social_user
ensure_env_value SCPO_XRAY_DB_USER scpo_xray_user
ensure_env_value SCPO_MAINTENANCE_DB_USER scpo_maintenance_user
ensure_urlsafe_env_value SCPO_SESSION_SIGNING_KEY
ensure_urlsafe_env_value SCPO_MFA_ENCRYPTION_KEY

for key in \
  POSTGRES_PASSWORD SCPO_SERVICE_TOKEN \
  SCPO_ACCESS_DB_PASSWORD SCPO_AUDIT_DB_PASSWORD SCPO_NURSING_DB_PASSWORD \
  SCPO_PHARMACY_DB_PASSWORD SCPO_SOCIAL_DB_PASSWORD SCPO_XRAY_DB_PASSWORD \
  SCPO_MAINTENANCE_DB_PASSWORD; do
  ensure_random_env_value "${key}"
done

if ! grep -Eq '^SCPO_BOOTSTRAP_ADMIN_TOKEN=.+$' "${temporary_env}"; then
  bootstrap_token_file="${project_dir}/data/local/bootstrap-admin.token"
  if [[ -s "${bootstrap_token_file}" ]]; then
    bootstrap_admin_token="$(<"${bootstrap_token_file}")"
  else
    bootstrap_admin_token="$(openssl rand -hex 32)"
    bootstrap_token_generated=true
  fi
  ensure_env_value SCPO_BOOTSTRAP_ADMIN_TOKEN "${bootstrap_admin_token}"
fi

install -d -o "${deployment_user}" -g "${deployment_group}" -m 0700 \
  "${project_dir}/data/local"
if [[ "${bootstrap_token_generated}" == "true" ]]; then
  sed -n 's/^SCPO_BOOTSTRAP_ADMIN_TOKEN=//p' "${temporary_env}" \
    > "${project_dir}/data/local/bootstrap-admin.token"
  chown "${deployment_user}:${deployment_group}" \
    "${project_dir}/data/local/bootstrap-admin.token"
  chmod 0600 "${project_dir}/data/local/bootstrap-admin.token"
fi

if [[ ! -e "${project_dir}/data/therapy-materials" ]]; then
  install -d -o 10001 -g 10001 -m 0750 "${project_dir}/data/therapy-materials"
fi
install -d -o 10001 -g 10001 -m 0750 "${project_dir}/data/backup-staging"

chown "${deployment_user}:${deployment_group}" "${temporary_env}"
chmod 0600 "${temporary_env}"
mv "${temporary_env}" "${project_dir}/.env"
chown "${deployment_user}:${deployment_group}" "${project_dir}/.env"
chmod 0600 "${project_dir}/.env"

docker compose config --quiet
if ! docker compose up -d --build --wait --wait-timeout 300; then
  docker compose ps >&2 || true
  docker compose logs --tail=120 >&2 || true
  fail "A subida do Compose falhou. Os estados e logs recentes foram exibidos acima."
fi

all_healthy=false
for attempt in $(seq 1 60); do
  all_healthy=true
  for service in "${required_api_services[@]}"; do
    container_id="$(docker compose ps -q "${service}")"
    if [[ -n "${container_id}" ]] \
      && [[ "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "${container_id}")" == "healthy" ]]; then
      continue
    fi
    all_healthy=false
    break
  done
  [[ "${all_healthy}" == "true" ]] && break
  sleep 5
done
if [[ "${all_healthy}" != "true" ]]; then
  docker compose ps >&2 || true
  docker compose logs --tail=120 >&2 || true
  fail "Nem todas as APIs ficaram saudáveis em cinco minutos. Consulte os logs antes de tentar novamente."
fi

install -d -o "${deployment_user}" -g "${deployment_group}" -m 0700 \
  "${project_dir}/data/local"
if [[ ! -f "${project_dir}/data/local/scpo-local-root.crt" ]]; then
  docker compose cp proxy:/data/caddy/pki/authorities/local/root.crt \
    "${project_dir}/data/local/scpo-local-root.crt"
  chmod 0644 "${project_dir}/data/local/scpo-local-root.crt"
  if [[ "${deployment_user}" != "root" ]] && id "${deployment_user}" >/dev/null 2>&1; then
    chown "${deployment_user}:$(id -gn "${deployment_user}")" \
      "${project_dir}/data/local/scpo-local-root.crt"
  fi
fi

internal_host="$(sed -n 's/^SCPO_INTERNAL_HOST=//p' "${project_dir}/.env" | head -n 1)"
https_port="$(sed -n 's/^SCPO_HTTPS_PORT=//p' "${project_dir}/.env" | head -n 1)"
https_port="${https_port:-7777}"
curl --silent --show-error --fail --insecure \
  --resolve "${internal_host}:${https_port}:127.0.0.1" \
  "https://${internal_host}:${https_port}/" >/dev/null \
  || fail "Os serviços estão saudáveis, mas a página HTTPS não respondeu."

if ! bootstrap_required="$(
  curl --silent --show-error --fail --insecure \
    --resolve "${internal_host}:${https_port}:127.0.0.1" \
    "https://${internal_host}:${https_port}/api/v1/auth/status" \
    | python3 -c 'import json, sys; value = json.load(sys.stdin).get("bootstrap_required"); sys.exit("Resposta inválida do status de autenticação") if not isinstance(value, bool) else print(str(value).lower())'
)"; then
  fail "Não foi possível consultar se o bootstrap inicial ainda é necessário."
fi

printf '\nInstalação concluída.\n'
printf 'Endereço: https://%s:%s\n' "${internal_host}" "${https_port}"
printf 'Certificado raiz público: %s/data/local/scpo-local-root.crt\n' "${project_dir}"
printf 'Impressão digital do certificado:\n'
openssl x509 -in "${project_dir}/data/local/scpo-local-root.crt" -noout -fingerprint -sha256
if [[ "${bootstrap_required}" == "true" ]]; then
  bootstrap_admin_token="$(sed -n 's/^SCPO_BOOTSTRAP_ADMIN_TOKEN=//p' "${project_dir}/.env" | head -n 1)"
  [[ -n "${bootstrap_admin_token}" ]] \
    || fail "Bootstrap necessário, mas SCPO_BOOTSTRAP_ADMIN_TOKEN está vazio em .env."
  printf '\nBootstrap inicial pendente. Token (use uma única vez):\n%s\n' \
    "${bootstrap_admin_token}"
  printf 'Guarde-o em local seguro e não o compartilhe.\n'
else
  printf '\nO bootstrap já foi concluído; o token não foi exibido.\n'
fi
printf '\nO certificado precisa ser distribuído e validado por canal institucional nos dispositivos clientes.\n'
printf 'Esta instalação não importa bancos nem autoriza uso com dados reais.\n'
