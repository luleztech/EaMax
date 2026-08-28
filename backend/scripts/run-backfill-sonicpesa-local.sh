#!/usr/bin/env bash
# Run SonicPesa premium backfill from your machine against Railway production.
# Requires: railway CLI logged in + project linked (Postgres or any service is fine).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

json_val() {
  local service="$1"
  local key="$2"
  railway variables -s "$service" --json | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8'))['$key']"
}

export DATABASE_URL="$(json_val Postgres DATABASE_PUBLIC_URL)"
export SONICPESA_API_KEY="$(json_val EaMax SONICPESA_API_KEY)"
export SONICPESA_WEBHOOK_SECRET="$(json_val EaMax SONICPESA_WEBHOOK_SECRET || echo '')"

echo "[run-backfill] DATABASE_URL -> Postgres public proxy"
echo "[run-backfill] SONICPESA_API_KEY -> EaMax service"
echo "[run-backfill] args: $*"
echo

node backend/scripts/backfill-sonicpesa-premium.js "$@"
