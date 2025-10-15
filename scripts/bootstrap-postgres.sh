#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/bootstrap-postgres.sh [--apply-migrations]

Creates the local PostgreSQL role and database expected by the Expenses
application. The script connects using the standard libpq environment
variables (PGHOST, PGPORT, PGUSER, PGPASSWORD, etc.) so run it as a superuser
or a role with privileges to create other roles and databases.

Environment variables:
  POSTGRES_DB        Database name to create (default: expenses)
  POSTGRES_USER      Application role name (default: expenses)
  POSTGRES_PASSWORD  Password for the application role (required)
  POSTGRES_SCHEMA    Schema to target when constructing DATABASE_URL
                     (default: public)
  DATABASE_URL       Optional connection string used when applying Prisma
                     migrations. If omitted a URL will be constructed from
                     the variables above.

Options:
  --apply-migrations  Run "npx prisma migrate deploy" after provisioning the
                      role and database. Requires Node.js dependencies to be
                      installed under the server/ workspace.
  -h, --help          Display this help message.
USAGE
}

RUN_MIGRATIONS=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply-migrations)
      RUN_MIGRATIONS=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

DB_NAME=${POSTGRES_DB:-expenses}
DB_USER=${POSTGRES_USER:-expenses}
DB_PASSWORD=${POSTGRES_PASSWORD:-}
DB_SCHEMA=${POSTGRES_SCHEMA:-public}

if [[ -z "$DB_PASSWORD" ]]; then
  echo "POSTGRES_PASSWORD must be provided." >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required but was not found on PATH." >&2
  exit 1
fi

PSQL_DB=${PGDATABASE:-postgres}

psql "${PSQL_DB}" -v ON_ERROR_STOP=1 \
  --set=db_user="$DB_USER" \
  --set=db_password="$DB_PASSWORD" \
  --set=db_name="$DB_NAME" <<'SQL'
DO
$$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'db_user') THEN
        EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', :'db_user', :'db_password');
    ELSE
        EXECUTE format('ALTER ROLE %I WITH LOGIN PASSWORD %L', :'db_user', :'db_password');
    END IF;
END
$$;
DO
$$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db_name') THEN
        EXECUTE format('CREATE DATABASE %I OWNER %I', :'db_name', :'db_user');
    END IF;
END
$$;
SQL

if (( RUN_MIGRATIONS )); then
  if ! command -v npx >/dev/null 2>&1; then
    echo "npx is required to apply migrations but was not found on PATH." >&2
    exit 1
  fi

  pushd server >/dev/null

  if [[ -z "${DATABASE_URL:-}" ]]; then
    HOST=${PGHOST:-localhost}
    PORT=${PGPORT:-5432}
    SCHEMA=${DB_SCHEMA}
    DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${HOST}:${PORT}/${DB_NAME}?schema=${SCHEMA}"
  fi

  DATABASE_URL="$DATABASE_URL" npx prisma migrate deploy
  popd >/dev/null
fi

echo "PostgreSQL role '${DB_USER}' and database '${DB_NAME}' are ready."
if (( RUN_MIGRATIONS )); then
  echo "Prisma migrations have been applied."
else
  echo "Run 'DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@${PGHOST:-localhost}:${PGPORT:-5432}/${DB_NAME}?schema=${DB_SCHEMA}' npx prisma migrate deploy" \
       "to sync the schema once Node.js dependencies are installed."
fi
