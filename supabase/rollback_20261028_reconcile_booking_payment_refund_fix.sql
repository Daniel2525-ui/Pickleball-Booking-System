-- ==============================================================================
-- Rollback Migration: rollback_20261028_reconcile_booking_payment_refund_fix.sql
-- Description: Restores public.reconcile_booking_payment to the definition
--              established in 20261027_payment_reconciliation_and_refund_ledger.sql.
-- Limitation Note: Rolling back after refund requests have been generated does NOT
--                  delete existing rows in public.refund_requests or revert payments.
--                  Financial records are permanently preserved to prevent audit loss.
-- ==============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.reconcile_booking_payment(
  p_booking_id uuid,
  p_payment_id uuid,
  p_stripe_session_id text,
  p_stripe_payment_intent text,
  p_amount numeric,
  p_currency text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_booking record;
  v_court record;
  v_payment record;
  v_existing_dup record;
  v_conflict_id uuid;
  v_is_past boolean;
  v_now timestamptz := clock_timestamp();
  v_dup_payment_id uuid;
  v_idempotency_key text;
  v_is_eligible_for_normal_confirm boolean;
  v_diag_constraint text;
  v_refund_res jsonb;
BEGIN
  IF coalesce(auth.role(), '') != 'service_role' AND (session_user != 'postgres' OR auth.role() IS NOT NULL) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Service role required' USING ERRCODE = '42501';
  END IF;

  IF p_stripe_payment_intent IS NULL OR trim(p_stripe_payment_intent) = '' THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: p_stripe_payment_intent cannot be empty' USING ERRCODE = '22000';
  END IF;
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: p_amount must be greater than zero' USING ERRCODE = '22000';
  END IF;

  -- 1. Lock target booking (Hierarchy Level 1)
  SELECT id, court_id, booking_date, start_time, end_time, status, total_amount, user_id
  INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Booking % does not exist', p_booking_id USING ERRCODE = 'P0002';
  END IF;

  -- 2. Lock court (Hierarchy Level 2)
  SELECT id, status INTO v_court
  FROM public.courts
  WHERE id = v_booking.court_id
  FOR UPDATE;

  IF NOT FOUND OR lower(coalesce(v_court.status, '')) != 'active' THEN
    v_idempotency_key := 'ref_court_unavail_' || p_payment_id;
    v_refund_res := public.reserve_payment_refund(
      p_payment_id, p_booking_id, p_amount, p_currency, 'stripe', 'COURT_UNAVAILABLE_REFUND', v_idempotency_key, p_stripe_payment_intent
    );
    UPDATE public.bookings SET status = 'cancelled', updated_at = v_now WHERE id = p_booking_id;
    RETURN jsonb_build_object(
      'action', 'REFUND_SCHEDULED', 
      'reason', 'COURT_UNAVAILABLE', 
      'idempotency_key', v_idempotency_key,
      'refund_request_id', v_refund_res->>'refund_request_id'
    );
  END IF;

  -- 3. Lock target payment (Hierarchy Level 3)
  SELECT id, booking_id, amount, currency, status, payment_method, stripe_session_id, stripe_payment_id
  INTO v_payment
  FROM public.payments
  WHERE id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Payment % does not exist', p_payment_id USING ERRCODE = 'P0002';
  END IF;

  IF v_payment.booking_id != p_booking_id THEN
    RAISE EXCEPTION 'MISMATCHED_ASSOCIATION: Payment does not belong to booking' USING ERRCODE = '22000';
  END IF;
  IF lower(v_payment.currency) != lower(p_currency) OR v_payment.amount != p_amount THEN
    RAISE EXCEPTION 'MISMATCHED_PAYMENT_DETAILS: Amount or currency mismatch' USING ERRCODE = '22000';
  END IF;

  -- Strict eligibility check for normal confirmation of v_payment
  v_is_eligible_for_normal_confirm := (
    v_payment.status = 'pending'
    AND (v_payment.payment_method IS NULL OR v_payment.payment_method = 'stripe')
    AND (v_payment.stripe_session_id IS NULL OR v_payment.stripe_session_id = p_stripe_session_id)
    AND (v_payment.stripe_payment_id IS NULL OR v_payment.stripe_payment_id = p_stripe_payment_intent)
  );

  -- Branch 1: Target booking already active / confirmed OR v_payment is ineligible for normal confirm
  IF v_booking.status IN ('confirmed', 'checked_in', 'in_progress', 'completed') OR NOT v_is_eligible_for_normal_confirm THEN
    -- Subcase 1.1: Exact redelivery of original Stripe payment
    IF v_payment.status = 'paid' 
       AND v_payment.stripe_payment_id = p_stripe_payment_intent 
       AND (v_payment.stripe_session_id IS NULL OR v_payment.stripe_session_id = p_stripe_session_id) THEN
      RETURN jsonb_build_object('action', 'NO_OP', 'status', 'ALREADY_CONFIRMED', 'booking_status', v_booking.status);
    END IF;

    -- Subcase 1.2: Legitimate backfill of missing stripe_payment_id on original Stripe session
    IF v_booking.status IN ('confirmed', 'checked_in', 'in_progress', 'completed')
       AND v_payment.status = 'paid' 
       AND v_payment.payment_method = 'stripe' 
       AND v_payment.stripe_session_id = p_stripe_session_id 
       AND v_payment.stripe_payment_id IS NULL THEN
      UPDATE public.payments 
      SET stripe_payment_id = p_stripe_payment_intent 
      WHERE id = v_payment.id;
      RETURN jsonb_build_object('action', 'NO_OP', 'status', 'ALREADY_CONFIRMED_BACKFILLED', 'booking_status', v_booking.status);
    END IF;

    -- Subcase 1.3: Isolated Duplicate Payment Attempt
    SELECT id, booking_id, amount, currency, status, stripe_session_id, stripe_payment_id
    INTO v_existing_dup
    FROM public.payments
    WHERE stripe_payment_id = p_stripe_payment_intent
    FOR UPDATE;

    IF FOUND THEN
      IF v_existing_dup.booking_id != p_booking_id 
         OR v_existing_dup.amount != p_amount 
         OR lower(v_existing_dup.currency) != lower(p_currency)
         OR (v_existing_dup.stripe_session_id IS NOT NULL AND v_existing_dup.stripe_session_id != p_stripe_session_id) THEN
        RAISE EXCEPTION 'AMBIGUOUS_PAYMENT_INTENT_ASSOCIATION: Conflicting metadata for PI %', p_stripe_payment_intent USING ERRCODE = '22000';
      END IF;
      v_dup_payment_id := v_existing_dup.id;
    ELSE
      BEGIN
        INSERT INTO public.payments (
          booking_id, amount, currency, status, payment_method, stripe_session_id, stripe_payment_id, paid_at
        ) VALUES (
          p_booking_id, p_amount, lower(p_currency), 'paid', 'stripe', p_stripe_session_id, p_stripe_payment_intent, v_now
        ) RETURNING id INTO v_dup_payment_id;
      EXCEPTION WHEN unique_violation THEN
        GET STACKED DIAGNOSTICS v_diag_constraint = CONSTRAINT_NAME;
        IF v_diag_constraint IS NOT NULL AND v_diag_constraint != 'idx_payments_stripe_payment_id' THEN
          RAISE;
        END IF;

        SELECT id, booking_id, amount, currency, status, stripe_session_id, stripe_payment_id
        INTO v_existing_dup
        FROM public.payments
        WHERE stripe_payment_id = p_stripe_payment_intent
        FOR UPDATE;

        IF NOT FOUND OR v_existing_dup.booking_id != p_booking_id 
           OR v_existing_dup.amount != p_amount 
           OR lower(v_existing_dup.currency) != lower(p_currency)
           OR (v_existing_dup.stripe_session_id IS NOT NULL AND v_existing_dup.stripe_session_id != p_stripe_session_id) THEN
          RAISE EXCEPTION 'AMBIGUOUS_PAYMENT_INTENT_ASSOCIATION: Unique collision metadata check failed for PI %', p_stripe_payment_intent USING ERRCODE = '22000';
        END IF;
        v_dup_payment_id := v_existing_dup.id;
      END;
    END IF;

    v_idempotency_key := 'ref_duplicate_pi_' || p_stripe_payment_intent;
    v_refund_res := public.reserve_payment_refund(
      v_dup_payment_id, p_booking_id, p_amount, p_currency, 'stripe', 'DUPLICATE_PAYMENT_REFUND', v_idempotency_key, p_stripe_payment_intent
    );
    RETURN jsonb_build_object('action', 'REFUND_SCHEDULED', 'reason', 'DUPLICATE_PAYMENT', 'payment_id', v_dup_payment_id, 'idempotency_key', v_idempotency_key, 'refund_request_id', v_refund_res->>'refund_request_id');
  END IF;

  -- Branch 2: Scheduled match time in Asia/Manila (+08:00) has passed
  v_is_past := ((v_booking.booking_date + v_booking.start_time) AT TIME ZONE 'Asia/Manila') <= v_now;
  IF v_is_past THEN
    v_idempotency_key := 'ref_past_slot_' || p_payment_id;
    v_refund_res := public.reserve_payment_refund(
      p_payment_id, p_booking_id, p_amount, p_currency, 'stripe', 'MATCH_START_PASSED_REFUND', v_idempotency_key, p_stripe_payment_intent
    );
    UPDATE public.bookings SET status = 'cancelled', updated_at = v_now WHERE id = p_booking_id;
    RETURN jsonb_build_object('action', 'REFUND_SCHEDULED', 'reason', 'MATCH_START_PASSED', 'payment_id', p_payment_id, 'idempotency_key', v_idempotency_key, 'refund_request_id', v_refund_res->>'refund_request_id');
  END IF;

  -- Branch 3: Booking explicitly cancelled
  IF v_booking.status = 'cancelled' THEN
    v_idempotency_key := 'ref_cancelled_' || p_payment_id;
    v_refund_res := public.reserve_payment_refund(
      p_payment_id, p_booking_id, p_amount, p_currency, 'stripe', 'CANCELLED_BOOKING_REFUND', v_idempotency_key, p_stripe_payment_intent
    );
    RETURN jsonb_build_object('action', 'REFUND_SCHEDULED', 'reason', 'CANCELLED_BOOKING', 'payment_id', p_payment_id, 'idempotency_key', v_idempotency_key, 'refund_request_id', v_refund_res->>'refund_request_id');
  END IF;

  -- Branch 4: Slot claimed by overlapping active reservation
  SELECT id INTO v_conflict_id
  FROM public.bookings
  WHERE court_id = v_booking.court_id
    AND booking_date = v_booking.booking_date
    AND id != p_booking_id
    AND status IN ('confirmed', 'checked_in', 'in_progress', 'completed')
    AND start_time < v_booking.end_time
    AND end_time > v_booking.start_time
  LIMIT 1;

  IF v_conflict_id IS NOT NULL THEN
    v_idempotency_key := 'ref_conflict_' || p_payment_id;
    v_refund_res := public.reserve_payment_refund(
      p_payment_id, p_booking_id, p_amount, p_currency, 'stripe', 'SLOT_CONFLICT_REFUND', v_idempotency_key, p_stripe_payment_intent
    );
    UPDATE public.bookings SET status = 'cancelled', updated_at = v_now WHERE id = p_booking_id;
    RETURN jsonb_build_object('action', 'REFUND_SCHEDULED', 'reason', 'SLOT_CONFLICT', 'payment_id', p_payment_id, 'idempotency_key', v_idempotency_key, 'refund_request_id', v_refund_res->>'refund_request_id');
  END IF;

  -- Branch 5: Eligible, Slot Free, Time Future -> Normal Confirmation
  UPDATE public.payments
  SET status = 'paid',
      stripe_session_id = coalesce(p_stripe_session_id, stripe_session_id),
      stripe_payment_id = p_stripe_payment_intent,
      payment_method = 'stripe',
      paid_at = v_now
  WHERE id = p_payment_id;

  UPDATE public.bookings
  SET status = 'confirmed',
      hold_expires_at = NULL,
      updated_at = v_now
  WHERE id = p_booking_id;

  RETURN jsonb_build_object('action', 'CONFIRMED', 'booking_id', p_booking_id, 'payment_id', p_payment_id);
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_booking_payment(uuid, uuid, text, text, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reconcile_booking_payment(uuid, uuid, text, text, numeric, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_booking_payment(uuid, uuid, text, text, numeric, text) TO service_role;

COMMIT;
