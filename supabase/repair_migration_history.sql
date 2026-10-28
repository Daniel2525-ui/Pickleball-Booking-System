-- ==============================================================================
-- Migration history repair (NOT a migration; run once by hand after approval)
-- Records six migrations that are live on the hosted project but were applied outside the
-- migration tool, so `supabase db push` will not try to re-run them. Equivalent to:
--   supabase migration repair --status applied 20261024 20261025 20261026 20261027 20261028 20261030
-- Evidence they are live (2026-10-28): every function they define matches the hosted
-- pg_proc body by md5, and their tables/constraints exist.
-- Insert-only and idempotent: existing history rows are never changed or deleted.
-- ==============================================================================

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES
  ('20261024', 'hold_court_booking_rpc'),
  ('20261025', 'stage2_game_day_status_tracking'),
  ('20261026', 'stage1_hold_expiry_and_checkout_compatibility'),
  ('20261027', 'payment_reconciliation_and_refund_ledger'),
  ('20261028', 'reconcile_booking_payment_refund_fix'),
  ('20261030', 'cancel_expired_booking_resilience')
ON CONFLICT (version) DO NOTHING;

-- Verify: 12 rows expected (6 above + the 6 recorded by the MCP migration tool), one per file in
-- supabase/migrations except the not-yet-applied hold_release_grace_period.pending.sql.
SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version;
