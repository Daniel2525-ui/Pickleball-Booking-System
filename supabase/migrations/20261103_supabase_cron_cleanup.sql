-- ==============================================================================
-- Migration: 20261103_supabase_cron_cleanup.sql
-- Description: Supabase Cron replaces Vercel Cron (the Hobby plan rejects */15).
--   The job only calls the existing /api/cron/cleanup-expired-bookings route, which keeps
--   every Stripe check (a session is inspected before any hold is cancelled or payment is
--   marked failed) and runs the refund worker. Nothing is cancelled in SQL here.
--
-- Prerequisites: two Vault secrets, created BEFORE this migration by the project owner in
-- Dashboard > Project Settings > Vault > Add new secret (never in git, chat, or a migration):
--   crosshair_app_url      production origin, e.g. https://example.com (no path, no trailing slash needed)
--   crosshair_cron_secret  exactly the CRON_SECRET value set in Vercel production
-- If either is missing, each run fails in cron.job_run_details with a clear message and sends
-- no request. Rotating CRON_SECRET: update Vercel and the Vault secret together.
--
-- Verify / diagnose:
--   SELECT jobid, schedule, active FROM cron.job WHERE jobname = 'cleanup-expired-bookings';
--   -- did the job run, and did it error before sending (e.g. missing secret)?
--   SELECT status, return_message, start_time FROM cron.job_run_details
--     WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'cleanup-expired-bookings')
--     ORDER BY start_time DESC LIMIT 10;
--   -- what did the route answer? (kept ~6 hours; 200 body has cancelled/reconciled/refund counts;
--   -- 401 JSON = secret mismatch, 401/403 HTML = Vercel deployment protection, error_msg = network/timeout)
--   SELECT id, status_code, left(content, 300) AS body, error_msg, created FROM net._http_response
--     ORDER BY created DESC LIMIT 10;
-- Run once by hand: SELECT command FROM cron.job WHERE jobname = 'cleanup-expired-bookings'; then execute it.
-- ==============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Scheduling an existing job name updates it instead of adding a second job, so re-running is safe.
SELECT cron.schedule(
  'cleanup-expired-bookings',
  '*/15 * * * *',
  $job$
  DO $do$
  DECLARE
    v_url text;
    v_secret text;
  BEGIN
    SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'crosshair_app_url';
    SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'crosshair_cron_secret';

    IF coalesce(v_url, '') = '' OR coalesce(v_secret, '') = '' THEN
      RAISE EXCEPTION 'cleanup-expired-bookings: Vault secret crosshair_app_url or crosshair_cron_secret is missing';
    END IF;

    PERFORM net.http_get(
      url := rtrim(v_url, '/') || '/api/cron/cleanup-expired-bookings',
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
      timeout_milliseconds := 15000
    );
  END
  $do$;
  $job$
);

COMMIT;
