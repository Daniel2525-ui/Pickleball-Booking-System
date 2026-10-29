-- Rollback: booking_cancel_reason — restores the previous function bodies and policy, then drops the column.
-- Dropping the column discards every recorded cancellation reason.
BEGIN;

CREATE OR REPLACE FUNCTION "public"."cancel_expired_booking"("p_booking_id" "uuid", "p_payment_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
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


CREATE OR REPLACE FUNCTION "public"."release_expired_court_holds"("p_court_id" "uuid", "p_booking_date" "date", "p_start_time" time without time zone, "p_end_time" time without time zone) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_ids uuid[];
BEGIN
  SELECT coalesce(array_agg(b.id), '{}') INTO v_ids
  FROM (
    SELECT id FROM public.bookings
    WHERE court_id = p_court_id
      AND booking_date = p_booking_date
      AND status = 'pending'
      AND public.hold_release_after(hold_expires_at, created_at) <= clock_timestamp()
      AND start_time < p_end_time
      AND end_time > p_start_time
    FOR UPDATE SKIP LOCKED
  ) b
  -- Same safety guards as cancel_expired_booking: never cancel paid or refunding holds
  WHERE NOT EXISTS (
      SELECT 1 FROM public.payments p
      WHERE p.booking_id = b.id
        AND (p.status IN ('paid', 'succeeded', 'refunded') OR p.paid_at IS NOT NULL)
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.refund_requests r
      WHERE r.booking_id = b.id
        AND r.status IN ('pending', 'processing', 'succeeded', 'pending_cash_handover', 'cash_refunded', 'requires_admin_review')
    );

  IF cardinality(v_ids) = 0 THEN
    RETURN 0;
  END IF;

  UPDATE public.payments SET status = 'failed'
  WHERE booking_id = ANY (v_ids) AND status = 'pending';

  UPDATE public.bookings SET status = 'cancelled', updated_at = clock_timestamp()
  WHERE id = ANY (v_ids);

  RETURN cardinality(v_ids);
END;
$$;


CREATE OR REPLACE FUNCTION "public"."reconcile_booking_payment"("p_booking_id" "uuid", "p_payment_id" "uuid", "p_stripe_session_id" "text", "p_stripe_payment_intent" "text", "p_amount" numeric, "p_currency" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
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

  -- Branch 1: Target booking already confirmed / active OR v_payment is ineligible for normal confirm
  IF v_booking.status IN ('confirmed', 'checked_in', 'in_progress', 'completed') OR NOT v_is_eligible_for_normal_confirm THEN
    -- Subcase 1.1: Exact redelivery of original Stripe payment (paid or already refunded)
    IF v_payment.status IN ('paid', 'refunded') 
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

  -- Branch 2: Court Unavailable (Inactive or Under Maintenance)
  IF NOT FOUND OR lower(coalesce(v_court.status, '')) != 'active' THEN
    UPDATE public.payments
    SET status = 'paid',
        payment_method = 'stripe',
        stripe_session_id = coalesce(p_stripe_session_id, stripe_session_id),
        stripe_payment_id = p_stripe_payment_intent,
        paid_at = v_now
    WHERE id = p_payment_id;

    UPDATE public.bookings
    SET status = 'cancelled',
        hold_expires_at = NULL,
        updated_at = v_now
    WHERE id = p_booking_id;

    v_idempotency_key := 'ref_court_unavail_' || p_payment_id;
    v_refund_res := public.reserve_payment_refund(
      p_payment_id, p_booking_id, p_amount, p_currency, 'stripe', 'COURT_UNAVAILABLE_REFUND', v_idempotency_key, p_stripe_payment_intent
    );

    RETURN jsonb_build_object(
      'action', 'REFUND_SCHEDULED', 
      'reason', 'COURT_UNAVAILABLE', 
      'payment_id', p_payment_id,
      'idempotency_key', v_idempotency_key,
      'refund_request_id', v_refund_res->>'refund_request_id'
    );
  END IF;

  -- Branch 3: Scheduled match time in Asia/Manila (+08:00) has passed
  v_is_past := ((v_booking.booking_date + v_booking.start_time) AT TIME ZONE 'Asia/Manila') <= v_now;
  IF v_is_past THEN
    UPDATE public.payments
    SET status = 'paid',
        payment_method = 'stripe',
        stripe_session_id = coalesce(p_stripe_session_id, stripe_session_id),
        stripe_payment_id = p_stripe_payment_intent,
        paid_at = v_now
    WHERE id = p_payment_id;

    UPDATE public.bookings
    SET status = 'cancelled',
        hold_expires_at = NULL,
        updated_at = v_now
    WHERE id = p_booking_id;

    v_idempotency_key := 'ref_past_slot_' || p_payment_id;
    v_refund_res := public.reserve_payment_refund(
      p_payment_id, p_booking_id, p_amount, p_currency, 'stripe', 'MATCH_START_PASSED_REFUND', v_idempotency_key, p_stripe_payment_intent
    );

    RETURN jsonb_build_object(
      'action', 'REFUND_SCHEDULED', 
      'reason', 'MATCH_START_PASSED', 
      'payment_id', p_payment_id, 
      'idempotency_key', v_idempotency_key, 
      'refund_request_id', v_refund_res->>'refund_request_id'
    );
  END IF;

  -- Branch 4: Booking was explicitly cancelled (e.g. by expiration cleanup)
  IF v_booking.status = 'cancelled' THEN
    UPDATE public.payments
    SET status = 'paid',
        payment_method = 'stripe',
        stripe_session_id = coalesce(p_stripe_session_id, stripe_session_id),
        stripe_payment_id = p_stripe_payment_intent,
        paid_at = v_now
    WHERE id = p_payment_id;

    v_idempotency_key := 'ref_cancelled_' || p_payment_id;
    v_refund_res := public.reserve_payment_refund(
      p_payment_id, p_booking_id, p_amount, p_currency, 'stripe', 'CANCELLED_BOOKING_REFUND', v_idempotency_key, p_stripe_payment_intent
    );

    RETURN jsonb_build_object(
      'action', 'REFUND_SCHEDULED', 
      'reason', 'CANCELLED_BOOKING', 
      'payment_id', p_payment_id, 
      'idempotency_key', v_idempotency_key, 
      'refund_request_id', v_refund_res->>'refund_request_id'
    );
  END IF;

  -- Branch 5: Slot claimed by overlapping active reservation
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
    UPDATE public.payments
    SET status = 'paid',
        payment_method = 'stripe',
        stripe_session_id = coalesce(p_stripe_session_id, stripe_session_id),
        stripe_payment_id = p_stripe_payment_intent,
        paid_at = v_now
    WHERE id = p_payment_id;

    UPDATE public.bookings
    SET status = 'cancelled',
        hold_expires_at = NULL,
        updated_at = v_now
    WHERE id = p_booking_id;

    v_idempotency_key := 'ref_conflict_' || p_payment_id;
    v_refund_res := public.reserve_payment_refund(
      p_payment_id, p_booking_id, p_amount, p_currency, 'stripe', 'SLOT_CONFLICT_REFUND', v_idempotency_key, p_stripe_payment_intent
    );

    RETURN jsonb_build_object(
      'action', 'REFUND_SCHEDULED', 
      'reason', 'SLOT_CONFLICT', 
      'payment_id', p_payment_id, 
      'idempotency_key', v_idempotency_key, 
      'refund_request_id', v_refund_res->>'refund_request_id'
    );
  END IF;

  -- Branch 6: Eligible, Slot Free, Time Future -> Normal Confirmation
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


CREATE OR REPLACE FUNCTION "public"."settle_counter_payment"("p_booking_id" "uuid", "p_payment_id" "uuid", "p_payment_method" "text", "p_payment_reference" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
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


DROP POLICY IF EXISTS bookings_update_policy ON public.bookings;
CREATE POLICY bookings_update_policy ON public.bookings
  FOR UPDATE
  USING (
    coalesce(auth.role(), '') = 'service_role'
    OR (current_user = 'postgres' AND auth.role() IS NULL)
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    OR (user_id = auth.uid() AND status = 'pending')
  )
  WITH CHECK (
    coalesce(auth.role(), '') = 'service_role'
    OR (current_user = 'postgres' AND auth.role() IS NULL)
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    OR (user_id = auth.uid() AND status = 'cancelled')
  );

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_cancel_reason_check;
ALTER TABLE public.bookings DROP COLUMN IF EXISTS cancel_reason;

COMMIT;
