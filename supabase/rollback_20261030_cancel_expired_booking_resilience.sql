-- ==============================================================================
-- Rollback Migration: rollback_20261030_cancel_expired_booking_resilience.sql
-- Description: Reverts cancel_expired_booking to the definition from
--              20261027_payment_reconciliation_and_refund_ledger.sql.
-- ==============================================================================

BEGIN;

-- 1. Explicitly drop function to clear parameter default metadata (DEFAULT NULL) from pg_proc
DROP FUNCTION IF EXISTS public.cancel_expired_booking(uuid, uuid);

-- 2. Restore exact original definition from 20261027_payment_reconciliation_and_refund_ledger.sql
CREATE OR REPLACE FUNCTION public.cancel_expired_booking(
  p_booking_id uuid,
  p_payment_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_booking record;
  v_payment record;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF coalesce(auth.role(), '') != 'service_role' AND (session_user != 'postgres' OR auth.role() IS NOT NULL) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Service role required' USING ERRCODE = '42501';
  END IF;

  -- 1. Lock bookings row (Hierarchy Level 1)
  SELECT id, status, hold_expires_at, created_at
  INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('cancelled', false, 'reason', 'BOOKING_NOT_FOUND');
  END IF;

  IF v_booking.status != 'pending' THEN
    RETURN jsonb_build_object('cancelled', false, 'reason', 'BOOKING_NOT_PENDING', 'status', v_booking.status);
  END IF;

  -- Verify hold has actually expired before permitting cancellation
  IF coalesce(v_booking.hold_expires_at, v_booking.created_at + interval '35 minutes') > v_now THEN
    RETURN jsonb_build_object('cancelled', false, 'reason', 'HOLD_NOT_EXPIRED', 'hold_expires_at', v_booking.hold_expires_at);
  END IF;

  -- 2. Lock payments row (Hierarchy Level 3)
  SELECT id, status
  INTO v_payment
  FROM public.payments
  WHERE id = p_payment_id AND booking_id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND OR v_payment.status != 'pending' THEN
    RETURN jsonb_build_object('cancelled', false, 'reason', 'PAYMENT_NOT_PENDING');
  END IF;

  -- 3. Atomic cancellation in single database transaction
  UPDATE public.payments 
  SET status = 'failed' 
  WHERE id = p_payment_id;

  UPDATE public.bookings 
  SET status = 'cancelled', 
      updated_at = v_now 
  WHERE id = p_booking_id;

  RETURN jsonb_build_object('cancelled', true, 'booking_id', p_booking_id, 'payment_id', p_payment_id);
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_expired_booking(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_expired_booking(uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_expired_booking(uuid, uuid) TO service_role;

COMMIT;
