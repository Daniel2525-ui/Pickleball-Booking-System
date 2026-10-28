-- ==============================================================================
-- Rollback: 20261103_supabase_cron_cleanup.sql
-- Stops the Supabase Cron cleanup job. Safe to run more than once.
-- Leaves pg_cron, pg_net and the Vault secrets in place (dropping the extensions would also
-- remove any other jobs or webhooks).
--
-- After this, nothing triggers /api/cron/cleanup-expired-bookings. Expired holds still free
-- their slots on the next booking (20261102), but missed Stripe webhooks are not reconciled,
-- stale pending rows stay pending, and queued Stripe refunds wait. Restore scheduling with ONE of:
--   1. Re-run supabase/migrations/20261028153353_20261103_supabase_cron_cleanup.sql (updates the same job).
--   2. Re-add vercel.json with a Hobby-compatible daily schedule, then deploy:
--        { "crons": [ { "path": "/api/cron/cleanup-expired-bookings", "schedule": "0 16 * * *" } ] }
--      (sub-daily schedules need a paid Vercel plan).
-- In the meantime, run it once by hand:
--   curl -H "Authorization: Bearer $CRON_SECRET" https://<production-origin>/api/cron/cleanup-expired-bookings
-- ==============================================================================

BEGIN;

SELECT cron.unschedule('cleanup-expired-bookings')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-expired-bookings');

COMMIT;
