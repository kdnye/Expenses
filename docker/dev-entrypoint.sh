#!/usr/bin/env bash
set -euo pipefail

if [ "${DEBUG_ENTRYPOINT:-}" = "1" ]; then
  set -x
fi

# Ensure we are running from the server workspace.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/../server"

# Install dependencies on first boot or when the lockfile changes. Reuse the persistent
# named volume across restarts to avoid reinstalling packages unnecessarily.
LOCKFILE_HASH="$(sha256sum package-lock.json | awk '{print $1}')"
LOCKFILE_STAMP="node_modules/.package-lock.hash"

if [ ! -d node_modules ] || [ ! -f "$LOCKFILE_STAMP" ] || [ "$(cat "$LOCKFILE_STAMP")" != "$LOCKFILE_HASH" ]; then
  echo "[entrypoint] Installing npm dependencies..."
  npm ci
  printf '%s' "$LOCKFILE_HASH" > "$LOCKFILE_STAMP"
else
  echo "[entrypoint] Reusing existing node_modules volume"
fi

# Generate the Prisma client to keep the TypeScript types in sync.
echo "[entrypoint] Generating Prisma client..."
npx prisma generate

if [ -z "${DATABASE_URL:-}" ]; then
  echo "[entrypoint] DATABASE_URL is not set; refusing to start." >&2
  exit 1
fi

# Apply migrations once the database is ready. Treat connectivity issues as retryable
# but surface real migration failures immediately so the container does not loop forever
# on an unrecoverable error.
PRISMA_OUTPUT="$(mktemp)"
trap 'rm -f "$PRISMA_OUTPUT"' EXIT

while true; do
  if npx prisma migrate deploy >"$PRISMA_OUTPUT" 2>&1; then
    cat "$PRISMA_OUTPUT"
    break
  fi

  if grep -Eq 'P1001|ECONNREFUSED|Timed out|database server was not found' "$PRISMA_OUTPUT"; then
    cat "$PRISMA_OUTPUT" >&2
    echo "[entrypoint] Waiting for Postgres to become ready..."
    sleep 3
    continue
  fi

  cat "$PRISMA_OUTPUT" >&2
  echo "[entrypoint] Prisma migrate failed with a non-recoverable error. Exiting." >&2
  exit 1
done

trap - EXIT
rm -f "$PRISMA_OUTPUT"

if [ "$#" -eq 0 ]; then
  echo "[entrypoint] Starting the API in watch mode"
  set -- npm run dev
else
  echo "[entrypoint] Executing custom command: $*"
fi

exec "$@"
