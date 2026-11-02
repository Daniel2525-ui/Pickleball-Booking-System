-- Rollback for the open play migrations (20261103000001..5), reverse order.
-- Restoring bookings.court_id NOT NULL only works once no spot rows (court_id NULL) exist:
-- delete or cancel-and-delete them (and their open play block rows) first.
-- Function bodies are the pre-branch definitions: confirm_checkout_hold from gcash_manual_payment,
-- reconcile_booking_payment from multi_court_basket, get_public_slot_availability from hold_release_grace_period.

BEGIN;

-- 20261103000005: public reads
DROP FUNCTION IF EXISTS public.get_open_play_sessions(date, date);
DROP FUNCTION IF EXISTS public.get_public_slot_availability(date);
-- 6. get_public_slot_availability (grid shows grace-period holds as taken) -----
CREATE OR REPLACE FUNCTION public.get_public_slot_availability(p_booking_date date)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  court_id uuid,
  start_time time,
  end_time time,
  status text,
  hold_expires_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT 
    CASE WHEN b.user_id = auth.uid() THEN b.id ELSE NULL END AS id,
    CASE WHEN b.user_id = auth.uid() THEN b.user_id ELSE NULL END AS user_id,
    b.court_id,
    b.start_time,
    b.end_time,
    b.status,
    CASE WHEN b.user_id = auth.uid() THEN b.hold_expires_at ELSE NULL END AS hold_expires_at
  FROM public.bookings b
  WHERE b.booking_date = p_booking_date
    AND (
      b.status IN ('confirmed', 'completed', 'checked_in', 'in_progress')
      OR (
        b.status = 'pending' 
        AND public.hold_release_after(b.hold_expires_at, b.created_at) > statement_timestamp()
      )
    );
$$;

ALTER FUNCTION public.get_public_slot_availability(date) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_public_slot_availability(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_slot_availability(date) TO anon, authenticated, service_role;

-- 20261103000004 / 3 / 2: open play functions
DROP FUNCTION IF EXISTS public.cancel_open_play_session(uuid);
DROP FUNCTION IF EXISTS public.add_open_play_walkup(uuid, uuid, text, int, text, text);
DROP FUNCTION IF EXISTS public.hold_open_play_spots(uuid, int, text);
DROP FUNCTION IF EXISTS public.generate_open_play_sessions(int);
DROP FUNCTION IF EXISTS public.set_open_play_schedule_active(uuid, boolean);
DROP FUNCTION IF EXISTS public.save_open_play_schedule(uuid, text, time, time, uuid[], int, numeric);

-- 20261103000003: pre-branch payment functions
CREATE OR REPLACE FUNCTION public.confirm_checkout_hold(
  p_booking_id uuid,
  p_payment_id uuid,
  p_stripe_session_id text,
  p_hold_expires_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_is_service_role boolean;
  v_court_id uuid;
  v_booking_date date;
  v_start_time time;
  v_end_time time;
  v_user_id uuid;
  v_status text;
  v_court_status text;
  v_conflict_id uuid;
  v_payment_status text;
  v_hold_expires_at timestamptz;
  v_payment_method text;
BEGIN
  -- 1. Input validation (trust boundary)
  IF p_stripe_session_id IS NULL OR trim(p_stripe_session_id) = '' THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: p_stripe_session_id cannot be empty' USING ERRCODE = '22000';
  END IF;

  IF p_hold_expires_at IS NULL OR p_hold_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: p_hold_expires_at must be in the future' USING ERRCODE = '22000';
  END IF;

  -- 2. Authorization: allow signed service_role JWTs or console psql
  v_is_service_role := (
    coalesce(auth.role(), '') = 'service_role'
    OR (session_user = 'postgres' AND auth.role() IS NULL)
  );

  -- 3. Lock target booking row and verify caller ownership (Hierarchy Level 1)
  SELECT court_id, booking_date, start_time, end_time, user_id, status, hold_expires_at
  INTO v_court_id, v_booking_date, v_start_time, v_end_time, v_user_id, v_status, v_hold_expires_at
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Booking does not exist' USING ERRCODE = 'P0002';
  END IF;

  IF NOT v_is_service_role THEN
    IF auth.uid() IS NULL OR coalesce(auth.role(), '') != 'authenticated' THEN
      RAISE EXCEPTION 'UNAUTHORIZED: Authentication required to confirm hold' USING ERRCODE = '42501';
    END IF;
    IF v_user_id != auth.uid() THEN
      RAISE EXCEPTION 'FORBIDDEN: Cannot confirm hold for another user' USING ERRCODE = '42501';
    END IF;
    -- Customers cannot extend their own hold indefinitely
    p_hold_expires_at := least(p_hold_expires_at, clock_timestamp() + interval '40 minutes');
  END IF;

  IF v_status != 'pending' THEN
    RAISE EXCEPTION 'INVALID_STATUS: Booking is not pending (status: %)', v_status USING ERRCODE = '22000';
  END IF;

  IF v_hold_expires_at = 'infinity' THEN
    RAISE EXCEPTION 'INVALID_STATUS: GCash payment is awaiting verification' USING ERRCODE = '22000';
  END IF;

  -- 4. Lock court row to serialize against all concurrent reservations on this court (Hierarchy Level 2)
  SELECT status INTO v_court_status
  FROM public.courts
  WHERE id = v_court_id
  FOR UPDATE;

  IF NOT FOUND OR lower(coalesce(v_court_status, '')) != 'active' THEN
    RAISE EXCEPTION 'COURT_UNAVAILABLE: Court is currently not available' USING ERRCODE = 'P0001';
  END IF;

  -- 5. Check for overlapping reservations (prevents resurrecting hold if slot was claimed after initial hold expired)
  SELECT id INTO v_conflict_id
  FROM public.bookings
  WHERE court_id = v_court_id
    AND booking_date = v_booking_date
    AND id != p_booking_id
    AND (
      status IN ('confirmed', 'checked_in', 'in_progress', 'completed')
      OR (
        status = 'pending'
        AND public.hold_release_after(hold_expires_at, created_at) > clock_timestamp()
      )
    )
    AND start_time < v_end_time
    AND end_time > v_start_time
  LIMIT 1;

  IF v_conflict_id IS NOT NULL THEN
    RAISE EXCEPTION 'SLOT_UNAVAILABLE' USING ERRCODE = 'P0001';
  END IF;

  -- 6. Lock and validate target payment row (Hierarchy Level 3)
  SELECT status, payment_method INTO v_payment_status, v_payment_method
  FROM public.payments
  WHERE id = p_payment_id AND booking_id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Payment % does not exist for booking %', p_payment_id, p_booking_id USING ERRCODE = 'P0002';
  END IF;

  IF v_payment_status != 'pending' THEN
    RAISE EXCEPTION 'INVALID_STATUS: Payment is not pending (status: %)', v_payment_status USING ERRCODE = '22000';
  END IF;

  IF v_payment_method = 'gcash' THEN
    RAISE EXCEPTION 'INVALID_STATUS: GCash payments are not confirmed through Stripe checkout' USING ERRCODE = '22000';
  END IF;

  -- 7. Atomically update hold expiry and stripe_session_id in the same database transaction
  UPDATE public.bookings
  SET hold_expires_at = p_hold_expires_at,
      updated_at = clock_timestamp()
  WHERE id = p_booking_id;

  UPDATE public.payments
  SET stripe_session_id = p_stripe_session_id
  WHERE id = p_payment_id;

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', p_booking_id,
    'payment_id', p_payment_id,
    'hold_expires_at', p_hold_expires_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_checkout_hold(uuid, uuid, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_checkout_hold(uuid, uuid, text, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.confirm_checkout_hold(uuid, uuid, text, timestamptz) TO authenticated, service_role;

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
      AND booking_id = p_booking_id
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
        IF v_diag_constraint IS NOT NULL AND v_diag_constraint != 'uq_payments_intent_per_booking' THEN
          RAISE;
        END IF;

        SELECT id, booking_id, amount, currency, status, stripe_session_id, stripe_payment_id
        INTO v_existing_dup
        FROM public.payments
        WHERE stripe_payment_id = p_stripe_payment_intent
          AND booking_id = p_booking_id
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

    v_idempotency_key := 'ref_duplicate_pi_' || p_stripe_payment_intent || '_' || p_booking_id;
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
        cancel_reason = 'court_unavailable',
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
        cancel_reason = 'start_passed',
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
        cancel_reason = 'slot_conflict',
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

REVOKE ALL ON FUNCTION public.reconcile_booking_payment(uuid, uuid, text, text, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reconcile_booking_payment(uuid, uuid, text, text, numeric, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_booking_payment(uuid, uuid, text, text, numeric, text) TO service_role;

-- 20261103000001: schema (open play functions, constraints, index, columns, tables)
DROP FUNCTION IF EXISTS public.open_play_player_spots(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.open_play_spots_taken(uuid, uuid);

ALTER TABLE public.bookings DROP CONSTRAINT bookings_customer_identity_check;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_customer_identity_check CHECK (
  (user_id IS NOT NULL AND customer_id IS NULL)
  OR (user_id IS NULL AND customer_id IS NOT NULL)
);
ALTER TABLE public.bookings DROP CONSTRAINT bookings_court_or_open_play;
DROP INDEX IF EXISTS public.bookings_open_play_session_idx;
ALTER TABLE public.bookings
  DROP COLUMN open_play_session_id,
  DROP COLUMN open_play_spots,
  ALTER COLUMN court_id SET NOT NULL;

DROP TABLE public.open_play_sessions;
DROP TABLE public.open_play_schedules;

COMMIT;
