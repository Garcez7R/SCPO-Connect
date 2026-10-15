#!/usr/bin/env bash
set -euo pipefail

for service in access audit nursing pharmacy social xray maintenance therapy; do
  role_variable="SCPO_${service^^}_DB_USER"
  password_variable="SCPO_${service^^}_DB_PASSWORD"
  role="${!role_variable:?Configure ${role_variable} before initializing PostgreSQL}"
  password="${!password_variable:?Configure ${password_variable} before initializing PostgreSQL}"
  database="scpo_${service}"

  psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
    --set=role="$role" --set=password="$password" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'role', :'password') \gexec
SQL
  createdb --username "$POSTGRES_USER" --owner "$role" "$database"
  psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
    --set=database="$database" <<'SQL'
SELECT format('REVOKE CONNECT ON DATABASE %I FROM PUBLIC', :'database') \gexec
SQL
done
