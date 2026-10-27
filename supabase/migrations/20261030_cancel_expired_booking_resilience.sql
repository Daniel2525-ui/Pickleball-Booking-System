-- ==============================================================================
-- Migration: 20261030_cancel_expired_booking_resilience.sql
-- Description: Enhances cancel_expired_booking RPC to:
--              1. Support optional p_payment_id (defaults to NULL) to safely cancel
--                 expired pending bookings with 0 payments or non-pending payments.
--              2. Protect settled payments (paid, succeeded, refunded, paid_at IS NOT NULL).
--              3. Protect active refund ledger requests (refund_requests).
--              4. Preserve strict hierarchy locking (bookings Level 1 -> payments Level 3).
--              5. Restrict execution strictly to service_role.
-- ==============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.cancel_expired_booking(
  p_booking_id uuid,
  p_payment_id uuid DEFAULT NULL
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
  -- 0. Authorization check: strictly require service_role
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

  -- 2. Verify hold has actually expired before permitting cancellation
  IF coalesce(v_booking.hold_expires_at, v_booking.created_at + interval '35 minutes') > v_now THEN
    RETURN jsonb_build_object('cancelled', false, 'reason', 'HOLD_NOT_EXPIRED', 'hold_expires_at', v_booking.hold_expires_at);
  END IF;

  -- 3. Payment safety guard: refuse cancellation if ANY payment for this booking is settled or marked paid
  IF EXISTS (
    SELECT 1 FROM public.payments
    WHERE booking_id = p_booking_id
      AND (
        status IN ('paid', 'succeeded', 'refunded')
        OR paid_at IS NOT NULL
      )
  ) THEN
    RETURN jsonb_build_object('cancelled', false, 'reason', 'PAYMENT_ALREADY_SETTLED');
  END IF;

  -- 4. Refund ledger safety guard: refuse cancellation if an active/pending refund exists
  IF EXISTS (
    SELECT 1 FROM public.refund_requests
    WHERE booking_id = p_booking_id
      AND status IN ('pending', 'processing', 'succeeded', 'pending_cash_handover', 'cash_refunded', 'requires_admin_review')
  ) THEN
    RETURN jsonb_build_object('cancelled', false, 'reason', 'REFUND_IN_PROGRESS');
  END IF;

  -- 5. Lock and update payments row (Hierarchy Level 3)
  IF p_payment_id IS NOT NULL THEN
    SELECT id, status
    INTO v_payment
    FROM public.payments
    WHERE id = p_payment_id AND booking_id = p_booking_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('cancelled', false, 'reason', 'PAYMENT_NOT_FOUND');
    END IF;

    IF v_payment.status = 'pending' THEN
      UPDATE public.payments 
      SET status = 'failed' 
      WHERE id = p_payment_id;
    END IF;
  ELSE
    -- If p_payment_id is omitted or NULL, mark any orphaned pending payments as failed
    UPDATE public.payments
    SET status = 'failed'
    WHERE booking_id = p_booking_id AND status = 'pending';
  END IF;

  -- 6. Atomic cancellation of the booking
  UPDATE public.bookings 
  SET status = 'cancelled', 
      updated_at = v_now 
  WHERE id = p_booking_id;

  RETURN jsonb_build_object('cancelled', true, 'booking_id', p_booking_id, 'payment_id', p_payment_id);
END;
$$;

-- Explicitly enforce privileges
REVOKE ALL ON FUNCTION public.cancel_expired_booking(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_expired_booking(uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_expired_booking(uuid, uuid) TO service_role;

COMMIT;
