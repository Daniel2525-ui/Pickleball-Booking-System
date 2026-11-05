#!/usr/bin/env bash
# Runs the app on :3200 against the LOCAL Supabase stack, for the e2e tests (see tests/e2e/README.md).
# .env.local points at production, so every variable it would set is set here first: Next.js never overrides
# a variable that is already in the environment, so production values can't load.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/tests/e2e/.env.e2e"
[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE: copy tests/e2e/e2e.env.example and fill it in."; exit 1; }
set -a; . "$ENV_FILE"; set +a

export NEXT_PUBLIC_SUPABASE_URL="$API_URL"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY"
export SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"
export STRIPE_WEBHOOK_SECRET CRON_SECRET
# Stripe: take ONLY the two Stripe keys from .env.local, and only if they are test-mode keys
read_local() { grep "^$1=" "$ROOT/.env.local" | cut -d= -f2- | tr -d '"\r'; }
export STRIPE_SECRET_KEY="$(read_local STRIPE_SECRET_KEY)"
export NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY="$(read_local NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)"

case "$STRIPE_SECRET_KEY" in sk_test_*) ;; *) echo "REFUSING: Stripe secret key is not a test key"; exit 1;; esac
case "$NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY" in pk_test_*) ;; *) echo "REFUSING: Stripe publishable key is not a test key"; exit 1;; esac
case "$NEXT_PUBLIC_SUPABASE_URL" in http://127.0.0.1:*|http://localhost:*) ;; *) echo "REFUSING: Supabase URL is not local"; exit 1;; esac

cd "$ROOT"
exec npx next dev -p 3200
