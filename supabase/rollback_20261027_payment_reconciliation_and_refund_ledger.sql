-- ==============================================================================
-- Rollback Migration: rollback_20261027_payment_reconciliation_and_refund_ledger.sql
-- Description: Non-destructive rollback for Phase 2 Payment Reconciliation & Refund Ledger
--              Drops functions and unique indexes.
--              Preserves public.refund_requests table and audit rows to prevent data loss.
-- ==============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.confirm_manual_cash_refund(uuid, text, text);
DROP FUNCTION IF EXISTS public.request_manual_cash_refund(uuid, uuid, numeric, text, text, text);
DROP FUNCTION IF EXISTS public.settle_counter_payment(uuid, uuid, text, text);
DROP FUNCTION IF EXISTS public.cancel_expired_booking(uuid, uuid);
DROP FUNCTION IF EXISTS public.claim_pending_refund_request(text, integer);
DROP FUNCTION IF EXISTS public.settle_stripe_refund(uuid, text, text, text, numeric, text);
DROP FUNCTION IF EXISTS public.reconcile_booking_payment(uuid, uuid, text, text, numeric, text);
DROP FUNCTION IF EXISTS public.reserve_payment_refund(uuid, uuid, numeric, text, text, text, text, text, uuid);

DROP INDEX IF EXISTS public.idx_refund_requests_worker_lease;
DROP INDEX IF EXISTS public.idx_refund_requests_booking_id;
DROP INDEX IF EXISTS public.idx_refund_requests_payment_id;
DROP INDEX IF EXISTS public.idx_refund_requests_stripe_refund_id;
DROP INDEX IF EXISTS public.idx_payments_stripe_payment_id;

COMMIT;
