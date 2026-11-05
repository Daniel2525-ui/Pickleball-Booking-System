#!/usr/bin/env bash
# Runs the Playwright e2e tests against the app started by scripts/e2e-app.sh (see tests/e2e/README.md).
# Extra arguments go to Playwright, e.g. scripts/e2e-test.sh tests/e2e/admin-staff.spec.mjs --project=desktop
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/tests/e2e/.env.e2e"
[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE: copy tests/e2e/e2e.env.example and fill it in."; exit 1; }
set -a; . "$ENV_FILE"; set +a

export E2E_LOCAL_DB=1 E2E_BASE_URL="http://localhost:3200"
export E2E_SUPABASE_URL="$API_URL" E2E_SUPABASE_ANON_KEY="$ANON_KEY" E2E_CRON_SECRET="$CRON_SECRET"
cd "$ROOT"
exec npx playwright test "$@"
