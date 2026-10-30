#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly remote_target="${SCPO_TEST_SERVER:-connect@192.168.1.216}"
readonly remote_app_dir="${SCPO_TEST_APP_DIR:-/home/connect/apps/SCPO-Connect}"

fail() {
  printf 'ERRO: %s\n' "$*" >&2
  exit 1
}

command -v git >/dev/null 2>&1 || fail "git não está instalado."
command -v ssh >/dev/null 2>&1 || fail "ssh não está instalado."
command -v scp >/dev/null 2>&1 || fail "scp não está instalado."
command -v gzip >/dev/null 2>&1 || fail "gzip não está instalado."

if [[ ! "${remote_target}" =~ ^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+$ ]]; then
  fail "Destino SSH inválido. Use o formato usuario@host."
fi
if [[ ! "${remote_app_dir}" =~ ^/[A-Za-z0-9._/-]+$ ]] \
  || [[ "${remote_app_dir}" == "/" ]] \
  || [[ "${remote_app_dir}" == *"/../"* ]] \
  || [[ "${remote_app_dir}" == */.. ]] \
  || [[ "${remote_app_dir}" == *"/./"* ]] \
  || [[ "${remote_app_dir}" == */. ]]; then
  fail "Diretório remoto inválido. Informe um caminho absoluto simples."
fi

cd "${project_dir}"
git rev-parse --show-toplevel >/dev/null 2>&1 \
  || fail "O diretório do projeto não é um repositório Git."
[[ -f docker-compose.yml && -f scripts/install-server-debian13.sh ]] \
  || fail "O repositório não contém os arquivos de implantação esperados."
[[ -z "$(git status --porcelain)" ]] \
  || fail "Há alterações locais. Faça commit ou descarte-as antes de publicar."

archive="$(mktemp "${TMPDIR:-/tmp}/scpo-connect-deploy.XXXXXX.tar.gz")"
trap 'rm -f "${archive}"' EXIT
git archive --format=tar HEAD | gzip -1 > "${archive}"

remote_archive="/tmp/scpo-connect-deploy-$(basename "${archive}")"
printf 'Enviando commit %s para %s:%s\n' \
  "$(git rev-parse --short HEAD)" "${remote_target}" "${remote_app_dir}"
scp -o BatchMode=yes "${archive}" "${remote_target}:${remote_archive}"

ssh -t -o BatchMode=yes "${remote_target}" \
  "set -eu
   trap \"rm -f '${remote_archive}'\" EXIT
   mkdir -p '${remote_app_dir}'
   tar -xzf '${remote_archive}' -C '${remote_app_dir}'
   cd '${remote_app_dir}'
   sudo bash scripts/install-server-debian13.sh"

printf '\nPublicação concluída em %s.\n' "${remote_target}"
