-- ==============================================================================
-- Migration: 20261027_payment_reconciliation_and_refund_ledger.sql
-- Description: Core Payment Integrity, Reconciliation, and Refund Ledger
--              1. Adds stripe_payment_id and unique index on public.payments.
--              2. Creates public.refund_requests audit ledger table.
--              3. Deploys reconcile_booking_payment authoritative RPC.
--              4. Deploys reserve_payment_refund transactional reservation RPC.
--              5. Deploys settle_stripe_refund verified settlement RPC.
--              6. Deploys claim_pending_refund_request worker lease RPC.
--              7. Deploys cancel_expired_booking atomic cleanup RPC.
--              8. Deploys settle_counter_payment atomic counter settlement RPC.
--              9. Deploys request_manual_cash_refund and confirm_manual_cash_refund.
-- Safety: Non-destructive DDL, strictly scoped privileges, universal lock hierarchy.
-- ==============================================================================

BEGIN;

-- 1. Ensure public.payments has stripe_payment_id column and partial unique index
ALTER TABLE public.payments 
  ADD COLUMN IF NOT EXISTS stripe_payment_id text DEFAULT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_stripe_payment_id 
  ON public.payments (stripe_payment_id) 
  WHERE stripe_payment_id IS NOT NULL;

-- 2. Create public.refund_requests audit ledger table
CREATE TABLE IF NOT EXISTS public.refund_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE RESTRICT,
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  amount numeric NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'php',
  payment_method text NOT NULL CHECK (payment_method IN ('stripe', 'cash', 'gcash')),
  reason text NOT NULL,
  status text NOT NULL CHECK (status IN (
    'pending', 
    'processing', 
    'succeeded', 
    'failed', 
    'requires_admin_review', 
    'pending_cash_handover', 
    'cash_refunded', 
    'cancelled'
  )),
  idempotency_key text NOT NULL CONSTRAINT uq_refund_requests_idempotency_key UNIQUE,
  stripe_payment_intent text DEFAULT NULL,
  stripe_refund_id text DEFAULT NULL,
  receipt_reference text DEFAULT NULL,
  cash_handover_notes text DEFAULT NULL,
  created_by uuid DEFAULT NULL REFERENCES public.profiles(id),
  confirmed_by uuid DEFAULT NULL REFERENCES public.profiles(id),
  handover_confirmed_at timestamptz DEFAULT NULL,
  locked_at timestamptz DEFAULT NULL,
  locked_by text DEFAULT NULL,
  lease_timeout_at timestamptz DEFAULT NULL,
  retry_count integer NOT NULL DEFAULT 0,
  error_message text DEFAULT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz DEFAULT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_refund_requests_stripe_refund_id 
  ON public.refund_requests (stripe_refund_id) 
  WHERE stripe_refund_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_refund_requests_payment_id 
  ON public.refund_requests (payment_id);

CREATE INDEX IF NOT EXISTS idx_refund_requests_booking_id 
  ON public.refund_requests (booking_id);

CREATE INDEX IF NOT EXISTS idx_refund_requests_worker_lease 
  ON public.refund_requests (status, lease_timeout_at, created_at) 
  WHERE status IN ('pending', 'processing');

-- 3. reserve_payment_refund RPC (Hierarchy Level 3 -> 4)
CREATE OR REPLACE FUNCTION public.reserve_payment_refund(
  p_payment_id uuid,
  p_booking_id uuid,
  p_amount numeric,
  p_currency text,
  p_payment_method text,
  p_reason text,
  p_idempotency_key text,
  p_stripe_payment_intent text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_payment record;
  v_existing record;
  v_reserved_sum numeric;
  v_new_req_id uuid;
  v_effective_pi text;
  v_init_status text;
  v_diag_constraint text;
BEGIN
  IF coalesce(auth.role(), '') != 'service_role' THEN
    IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
      RAISE EXCEPTION 'FORBIDDEN: Admin or service role required' USING ERRCODE = '42501';
    END IF;
    p_created_by := auth.uid();
  END IF;

  IF p_idempotency_key IS NULL OR trim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: p_idempotency_key cannot be blank' USING ERRCODE = '22000';
  END IF;

  -- 1. Lock payment row (Hierarchy Level 3)
  SELECT id, booking_id, amount, currency, payment_method, status, stripe_payment_id
  INTO v_payment
  FROM public.payments
  WHERE id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Payment % does not exist', p_payment_id USING ERRCODE = 'P0002';
  END IF;

  IF v_payment.status NOT IN ('paid', 'refunded') THEN
    RAISE EXCEPTION 'INELIGIBLE_PAYMENT: Payment status is %, expected paid', v_payment.status USING ERRCODE = '22000';
  END IF;
  IF v_payment.booking_id != p_booking_id THEN
    RAISE EXCEPTION 'MISMATCHED_ASSOCIATION: Payment does not belong to booking' USING ERRCODE = '22000';
  END IF;
  IF lower(v_payment.currency) != lower(trim(p_currency)) THEN
    RAISE EXCEPTION 'MISMATCHED_CURRENCY: Expected %, got %', v_payment.currency, p_currency USING ERRCODE = '22000';
  END IF;
  IF lower(v_payment.payment_method) != lower(trim(p_payment_method)) THEN
    RAISE EXCEPTION 'MISMATCHED_PAYMENT_METHOD: Payment is %, requested %', v_payment.payment_method, p_payment_method USING ERRCODE = '22000';
  END IF;

  -- Compute normalized effective PaymentIntent
  v_effective_pi := coalesce(p_stripe_payment_intent, v_payment.stripe_payment_id);

  IF lower(trim(p_payment_method)) = 'stripe' AND v_payment.stripe_payment_id IS NOT NULL AND v_effective_pi IS NOT NULL THEN
    IF v_payment.stripe_payment_id != v_effective_pi THEN
      RAISE EXCEPTION 'MISMATCHED_PAYMENT_INTENT: Payment has %, requested %', v_payment.stripe_payment_id, v_effective_pi USING ERRCODE = '22000';
    END IF;
  END IF;

  -- Full-refund-only enforcement
  IF p_amount != v_payment.amount THEN
    RAISE EXCEPTION 'FULL_REFUND_ONLY: Partial refunds prohibited. Captured %, requested %', v_payment.amount, p_amount USING ERRCODE = '22000';
  END IF;

  -- 2. Inspect existing idempotency key (Hierarchy Level 4)
  SELECT * INTO v_existing
  FROM public.refund_requests
  WHERE idempotency_key = trim(p_idempotency_key)
  FOR UPDATE;

  IF FOUND THEN
    -- Verify complete normalized tuple
    IF v_existing.payment_id = p_payment_id
       AND v_existing.booking_id = p_booking_id
       AND v_existing.amount = p_amount
       AND lower(v_existing.currency) = lower(trim(p_currency))
       AND lower(v_existing.payment_method) = lower(trim(p_payment_method))
       AND trim(v_existing.reason) = trim(p_reason)
       AND coalesce(v_existing.stripe_payment_intent, '') = coalesce(v_effective_pi, '') THEN
      RETURN jsonb_build_object(
        'success', true,
        'idempotent', true,
        'refund_request_id', v_existing.id,
        'status', v_existing.status,
        'amount', v_existing.amount
      );
    ELSE
      RAISE EXCEPTION 'IDEMPOTENCY_KEY_CONFLICT: Key % already used with conflicting parameters', p_idempotency_key USING ERRCODE = '22000';
    END IF;
  END IF;

  -- 3. Check cumulative capacity across all non-freed statuses
  SELECT coalesce(sum(amount), 0) INTO v_reserved_sum
  FROM public.refund_requests
  WHERE payment_id = p_payment_id
    AND status IN ('pending', 'processing', 'succeeded', 'requires_admin_review', 'pending_cash_handover', 'cash_refunded');

  IF (v_reserved_sum + p_amount) > v_payment.amount THEN
    RAISE EXCEPTION 'REFUND_CAP_EXCEEDED: Requested % exceeds remaining capacity %',
      p_amount, (v_payment.amount - v_reserved_sum) USING ERRCODE = '22003';
  END IF;

  v_init_status := CASE WHEN lower(trim(p_payment_method)) = 'cash' THEN 'pending_cash_handover' ELSE 'pending' END;

  -- 4. Insert reservation record
  INSERT INTO public.refund_requests (
    payment_id,
    booking_id,
    amount,
    currency,
    payment_method,
    reason,
    idempotency_key,
    stripe_payment_intent,
    status,
    created_by
  ) VALUES (
    p_payment_id,
    p_booking_id,
    p_amount,
    lower(trim(p_currency)),
    lower(trim(p_payment_method)),
    trim(p_reason),
    trim(p_idempotency_key),
    v_effective_pi,
    v_init_status,
    p_created_by
  ) RETURNING id INTO v_new_req_id;

  RETURN jsonb_build_object(
    'success', true,
    'idempotent', false,
    'refund_request_id', v_new_req_id,
    'status', v_init_status,
    'amount', p_amount
  );

EXCEPTION
  WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_diag_constraint = CONSTRAINT_NAME;
    IF v_diag_constraint IS NOT NULL AND v_diag_constraint != 'uq_refund_requests_idempotency_key' THEN
      RAISE;
    END IF;

    SELECT * INTO v_existing FROM public.refund_requests WHERE idempotency_key = trim(p_idempotency_key) FOR UPDATE;
    IF FOUND AND v_existing.payment_id = p_payment_id 
       AND v_existing.booking_id = p_booking_id
       AND v_existing.amount = p_amount
       AND lower(v_existing.currency) = lower(trim(p_currency))
       AND lower(v_existing.payment_method) = lower(trim(p_payment_method))
       AND trim(v_existing.reason) = trim(p_reason)
       AND coalesce(v_existing.stripe_payment_intent, '') = coalesce(v_effective_pi, '') THEN
      RETURN jsonb_build_object('success', true, 'idempotent', true, 'refund_request_id', v_existing.id, 'status', v_existing.status);
    ELSE
      RAISE EXCEPTION 'IDEMPOTENCY_KEY_CONFLICT: Concurrent unique violation with different parameters' USING ERRCODE = '22000';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_payment_refund(uuid, uuid, numeric, text, text, text, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reserve_payment_refund(uuid, uuid, numeric, text, text, text, text, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.reserve_payment_refund(uuid, uuid, numeric, text, text, text, text, text, uuid) TO authenticated, service_role;

-- 4. reconcile_booking_payment RPC (Hierarchy Level 1 -> 2 -> 3 -> 4)
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

-- 5. settle_stripe_refund RPC (Hierarchy Level 3 -> 4)
CREATE OR REPLACE FUNCTION public.settle_stripe_refund(
  p_refund_request_id uuid,
  p_stripe_refund_id text,
  p_stripe_status text,
  p_stripe_payment_intent text,
  p_amount numeric,
  p_currency text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_refund_req record;
  v_payment record;
  v_total_succeeded numeric;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF coalesce(auth.role(), '') != 'service_role' AND (session_user != 'postgres' OR auth.role() IS NOT NULL) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Service role required' USING ERRCODE = '42501';
  END IF;

  -- 1. Lock payments row (Hierarchy Level 3)
  SELECT p.* INTO v_payment
  FROM public.payments p
  JOIN public.refund_requests r ON r.payment_id = p.id
  WHERE r.id = p_refund_request_id
  FOR UPDATE OF p;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Payment record for refund request % not found', p_refund_request_id USING ERRCODE = 'P0002';
  END IF;

  -- 2. Lock refund_requests row (Hierarchy Level 4)
  SELECT * INTO v_refund_req
  FROM public.refund_requests
  WHERE id = p_refund_request_id
  FOR UPDATE;

  -- Verify association, amount, currency, and PaymentIntent
  IF v_refund_req.amount != p_amount OR v_payment.amount != p_amount THEN
    RAISE EXCEPTION 'MISMATCHED_AMOUNT: Settlement amount % does not match payment amount %', p_amount, v_payment.amount USING ERRCODE = '22000';
  END IF;
  IF lower(v_refund_req.currency) != lower(p_currency) OR lower(v_payment.currency) != lower(p_currency) THEN
    RAISE EXCEPTION 'MISMATCHED_CURRENCY: Settlement currency % does not match payment currency %', p_currency, v_payment.currency USING ERRCODE = '22000';
  END IF;
  IF v_refund_req.stripe_payment_intent IS NOT NULL AND v_refund_req.stripe_payment_intent != p_stripe_payment_intent THEN
    RAISE EXCEPTION 'MISMATCHED_PAYMENT_INTENT: Expected %, got %', v_refund_req.stripe_payment_intent, p_stripe_payment_intent USING ERRCODE = '22000';
  END IF;

  -- Idempotency check for already succeeded settlement
  IF v_refund_req.status = 'succeeded' THEN
    IF v_refund_req.stripe_refund_id = p_stripe_refund_id THEN
      RETURN jsonb_build_object('success', true, 'status', 'succeeded', 'idempotent', true);
    ELSE
      RAISE EXCEPTION 'CONFLICT: Request already succeeded with different refund ID %', v_refund_req.stripe_refund_id USING ERRCODE = '22000';
    END IF;
  END IF;

  -- Validate Stripe Refund ID uniqueness across requests
  IF p_stripe_refund_id IS NOT NULL AND trim(p_stripe_refund_id) != '' THEN
    IF EXISTS (
      SELECT 1 FROM public.refund_requests 
      WHERE stripe_refund_id = p_stripe_refund_id AND id != p_refund_request_id
    ) THEN
      RAISE EXCEPTION 'DUPLICATE_STRIPE_REFUND_ID: Refund ID % already used', p_stripe_refund_id USING ERRCODE = '23505';
    END IF;
  END IF;

  -- Handle Verified Terminal Success
  IF lower(p_stripe_status) = 'succeeded' THEN
    IF p_stripe_refund_id IS NULL OR trim(p_stripe_refund_id) = '' THEN
      RAISE EXCEPTION 'INVALID_ARGUMENT: Persisted stripe_refund_id is required for succeeded settlement' USING ERRCODE = '22000';
    END IF;

    -- Cumulative check to prevent over-refunds
    SELECT coalesce(sum(amount), 0) INTO v_total_succeeded
    FROM public.refund_requests
    WHERE payment_id = v_payment.id AND status = 'succeeded' AND id != p_refund_request_id;

    IF (v_total_succeeded + p_amount) > v_payment.amount THEN
      RAISE EXCEPTION 'OVER_REFUND_PREVENTED: Total % exceeds captured %', (v_total_succeeded + p_amount), v_payment.amount USING ERRCODE = '22003';
    END IF;

    UPDATE public.refund_requests
    SET status = 'succeeded',
        stripe_refund_id = trim(p_stripe_refund_id),
        stripe_payment_intent = p_stripe_payment_intent,
        processed_at = v_now,
        updated_at = v_now,
        error_message = NULL
    WHERE id = p_refund_request_id;

    -- Full-refund policy: exactly 100% refunded
    UPDATE public.payments 
    SET status = 'refunded' 
    WHERE id = v_payment.id;

    RETURN jsonb_build_object('success', true, 'status', 'succeeded', 'payment_status', 'refunded');

  -- Handle Nonterminal States: Must never mark payment as refunded
  ELSIF lower(p_stripe_status) IN ('pending', 'processing') THEN
    UPDATE public.refund_requests
    SET status = 'processing',
        stripe_refund_id = coalesce(trim(p_stripe_refund_id), stripe_refund_id),
        stripe_payment_intent = p_stripe_payment_intent,
        updated_at = v_now
    WHERE id = p_refund_request_id;

    RETURN jsonb_build_object('success', true, 'status', 'processing', 'payment_status', v_payment.status);

  -- Handle Terminal Failure
  ELSIF lower(p_stripe_status) = 'failed' THEN
    UPDATE public.refund_requests
    SET status = 'failed',
        stripe_refund_id = coalesce(trim(p_stripe_refund_id), stripe_refund_id),
        error_message = 'Stripe terminal refund failure',
        updated_at = v_now
    WHERE id = p_refund_request_id;

    RETURN jsonb_build_object('success', true, 'status', 'failed', 'payment_status', v_payment.status);

  ELSE
    -- Uncertain status -> requires admin review
    UPDATE public.refund_requests
    SET status = 'requires_admin_review',
        stripe_refund_id = coalesce(trim(p_stripe_refund_id), stripe_refund_id),
        error_message = 'Uncertain Stripe status: ' || p_stripe_status,
        updated_at = v_now
    WHERE id = p_refund_request_id;

    RETURN jsonb_build_object('success', true, 'status', 'requires_admin_review', 'payment_status', v_payment.status);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.settle_stripe_refund(uuid, text, text, text, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.settle_stripe_refund(uuid, text, text, text, numeric, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_stripe_refund(uuid, text, text, text, numeric, text) TO service_role;

-- 6. claim_pending_refund_request RPC (Hierarchy Level 4)
CREATE OR REPLACE FUNCTION public.claim_pending_refund_request(
  p_worker_id text,
  p_lease_seconds integer DEFAULT 60
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_claimed record;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF coalesce(auth.role(), '') != 'service_role' AND (session_user != 'postgres' OR auth.role() IS NOT NULL) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Service role required' USING ERRCODE = '42501';
  END IF;

  IF p_worker_id IS NULL OR trim(p_worker_id) = '' THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: p_worker_id cannot be empty' USING ERRCODE = '22000';
  END IF;

  IF p_lease_seconds IS NULL OR p_lease_seconds < 10 OR p_lease_seconds > 300 THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: p_lease_seconds must be between 10 and 300' USING ERRCODE = '22000';
  END IF;

  -- Escalate expired leases that reached retry limit to requires_admin_review (preserves refund capacity)
  UPDATE public.refund_requests
  SET status = 'requires_admin_review',
      error_message = 'Exceeded maximum worker lease attempts (5)',
      updated_at = v_now
  WHERE status = 'processing' 
    AND lease_timeout_at < v_now 
    AND retry_count >= 5;

  -- Claim next available job
  UPDATE public.refund_requests
  SET locked_at = v_now,
      locked_by = trim(p_worker_id),
      lease_timeout_at = v_now + (p_lease_seconds || ' seconds')::interval,
      status = 'processing',
      retry_count = retry_count + 1,
      updated_at = v_now
  WHERE id = (
    SELECT id
    FROM public.refund_requests
    WHERE (status = 'pending' AND (locked_at IS NULL OR lease_timeout_at < v_now))
       OR (status = 'processing' AND lease_timeout_at < v_now AND retry_count < 5)
    ORDER BY created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  RETURNING * INTO v_claimed;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('claimed', false);
  END IF;

  RETURN jsonb_build_object(
    'claimed', true,
    'refund_request', row_to_json(v_claimed)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_pending_refund_request(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_pending_refund_request(text, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pending_refund_request(text, integer) TO service_role;

-- 7. cancel_expired_booking RPC (Hierarchy Level 1 -> 3)
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

-- 8. settle_counter_payment RPC (Hierarchy Level 1 -> 2 -> 3)
CREATE OR REPLACE FUNCTION public.settle_counter_payment(
  p_booking_id uuid,
  p_payment_id uuid,
  p_payment_method text,
  p_payment_reference text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_admin_id uuid;
  v_booking record;
  v_court record;
  v_payment record;
  v_conflict_id uuid;
  v_now timestamptz := clock_timestamp();
BEGIN
  -- Caller Authorization: Authenticated Admin
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_admin_id 
  FROM public.profiles 
  WHERE id = auth.uid() AND role = 'admin';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FORBIDDEN: Admin privileges required' USING ERRCODE = '42501';
  END IF;

  p_payment_method := lower(trim(p_payment_method));
  IF p_payment_method NOT IN ('cash', 'gcash') THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: payment_method must be cash or gcash' USING ERRCODE = '22000';
  END IF;

  IF p_payment_method = 'gcash' AND (p_payment_reference IS NULL OR trim(p_payment_reference) = '') THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: GCash settlement requires non-empty payment_reference' USING ERRCODE = '22000';
  END IF;

  -- 1. Lock bookings row (Hierarchy Level 1)
  SELECT id, court_id, booking_date, start_time, end_time, status, user_id
  INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Booking % does not exist', p_booking_id USING ERRCODE = 'P0002';
  END IF;

  IF v_booking.status != 'pending' THEN
    RAISE EXCEPTION 'INVALID_STATUS: Booking is in status %, expected pending', v_booking.status USING ERRCODE = '22000';
  END IF;

  -- Reject if match start time has passed in Asia/Manila (+08:00)
  IF ((v_booking.booking_date + v_booking.start_time) AT TIME ZONE 'Asia/Manila') <= v_now THEN
    RAISE EXCEPTION 'MATCH_START_PASSED: Scheduled start time has already passed' USING ERRCODE = '22000';
  END IF;

  -- 2. Lock courts row (Hierarchy Level 2)
  SELECT id, status INTO v_court
  FROM public.courts
  WHERE id = v_booking.court_id
  FOR UPDATE;

  IF NOT FOUND OR lower(coalesce(v_court.status, '')) != 'active' THEN
    RAISE EXCEPTION 'COURT_UNAVAILABLE: Court is not active' USING ERRCODE = 'P0001';
  END IF;

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
    RAISE EXCEPTION 'SLOT_UNAVAILABLE: Overlapping confirmed booking exists' USING ERRCODE = 'P0001';
  END IF;

  -- 3. Lock payments row (Hierarchy Level 3)
  SELECT id, booking_id, status, amount
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

  IF v_payment.status != 'pending' THEN
    RAISE EXCEPTION 'INVALID_STATUS: Payment is in status %, expected pending', v_payment.status USING ERRCODE = '22000';
  END IF;

  -- 4. Atomically update payment and booking rows
  UPDATE public.payments
  SET status = 'paid',
      payment_method = p_payment_method,
      payment_reference = trim(p_payment_reference),
      paid_at = v_now
  WHERE id = p_payment_id;

  UPDATE public.bookings
  SET status = 'confirmed',
      hold_expires_at = NULL,
      updated_at = v_now
  WHERE id = p_booking_id;

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', p_booking_id,
    'payment_id', p_payment_id,
    'status', 'confirmed',
    'paid_at', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION public.settle_counter_payment(uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.settle_counter_payment(uuid, uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.settle_counter_payment(uuid, uuid, text, text) TO authenticated, service_role;

-- 9. request_manual_cash_refund & confirm_manual_cash_refund
CREATE OR REPLACE FUNCTION public.request_manual_cash_refund(
  p_payment_id uuid,
  p_booking_id uuid,
  p_amount numeric,
  p_currency text,
  p_reason text,
  p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_admin_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required' USING ERRCODE = '42501';
  END IF;
  SELECT id INTO v_admin_id FROM public.profiles WHERE id = auth.uid() AND role = 'admin';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FORBIDDEN: Admin privileges required' USING ERRCODE = '42501';
  END IF;

  RETURN public.reserve_payment_refund(
    p_payment_id, p_booking_id, p_amount, p_currency, 'cash', p_reason, p_idempotency_key, NULL, v_admin_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_manual_cash_refund(
  p_refund_request_id uuid,
  p_receipt_reference text,
  p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_admin_id uuid;
  v_refund_req record;
  v_payment record;
  v_total_refunded numeric;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required' USING ERRCODE = '42501';
  END IF;
  SELECT id INTO v_admin_id FROM public.profiles WHERE id = auth.uid() AND role = 'admin';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FORBIDDEN: Admin privileges required' USING ERRCODE = '42501';
  END IF;

  IF p_receipt_reference IS NULL OR trim(p_receipt_reference) = '' THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Receipt reference cannot be empty' USING ERRCODE = '22000';
  END IF;

  -- Lock payments (Hierarchy Level 3)
  SELECT p.* INTO v_payment
  FROM public.payments p
  JOIN public.refund_requests r ON r.payment_id = p.id
  WHERE r.id = p_refund_request_id
  FOR UPDATE OF p;

  -- Lock refund_requests (Hierarchy Level 4)
  SELECT * INTO v_refund_req
  FROM public.refund_requests
  WHERE id = p_refund_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Refund request does not exist' USING ERRCODE = 'P0002';
  END IF;

  IF v_refund_req.status = 'cash_refunded' THEN
    RETURN jsonb_build_object('success', true, 'status', 'cash_refunded', 'idempotent', true);
  END IF;

  IF v_refund_req.status != 'pending_cash_handover' THEN
    RAISE EXCEPTION 'INVALID_STATUS: Refund request is in status %, expected pending_cash_handover', v_refund_req.status USING ERRCODE = '22000';
  END IF;

  UPDATE public.refund_requests
  SET status = 'cash_refunded',
      receipt_reference = trim(p_receipt_reference),
      cash_handover_notes = p_notes,
      confirmed_by = v_admin_id,
      handover_confirmed_at = v_now,
      processed_at = v_now,
      updated_at = v_now
  WHERE id = p_refund_request_id;

  SELECT coalesce(sum(amount), 0) INTO v_total_refunded
  FROM public.refund_requests
  WHERE payment_id = v_payment.id AND status = 'cash_refunded';

  IF v_total_refunded = v_payment.amount THEN
    UPDATE public.payments SET status = 'refunded' WHERE id = v_payment.id;
  END IF;

  RETURN jsonb_build_object('success', true, 'status', 'cash_refunded', 'payment_status', CASE WHEN v_total_refunded = v_payment.amount THEN 'refunded' ELSE v_payment.status END);
END;
$$;

REVOKE ALL ON FUNCTION public.request_manual_cash_refund(uuid, uuid, numeric, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.request_manual_cash_refund(uuid, uuid, numeric, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.request_manual_cash_refund(uuid, uuid, numeric, text, text, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.confirm_manual_cash_refund(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_manual_cash_refund(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.confirm_manual_cash_refund(uuid, text, text) TO authenticated, service_role;

COMMIT;
