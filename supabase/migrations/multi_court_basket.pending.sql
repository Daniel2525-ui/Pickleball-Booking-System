-- ==============================================================================
-- Migration: multi_court_basket
-- Description: a customer can hold several courts in one checkout. Each court stays its own bookings
--   row with its own payments row; all payment rows of a basket share one Stripe session and intent.
--   Idempotent: safe to re-run.
-- ==============================================================================

BEGIN;

-- Section 1: basket grouping
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS basket_id uuid;
CREATE INDEX IF NOT EXISTS idx_bookings_basket_id ON public.bookings (basket_id) WHERE basket_id IS NOT NULL;

-- Section 2: Stripe ids unique per booking instead of globally; duplicate lookup ignores sibling rows
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_stripe_session_id_key;
DROP INDEX IF EXISTS public.idx_payments_stripe_payment_id;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_session_per_booking ON public.payments (stripe_session_id, booking_id) WHERE stripe_session_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_intent_per_booking ON public.payments (stripe_payment_id, booking_id) WHERE stripe_payment_id IS NOT NULL;

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

-- Section 3: all-or-nothing basket hold; one open basket per customer (replaces the 3-hold cap)
DROP FUNCTION IF EXISTS public.hold_court_booking(uuid, date, time, time, uuid, numeric, timestamptz);

CREATE OR REPLACE FUNCTION "public"."hold_court_booking"("p_court_id" "uuid", "p_booking_date" "date", "p_start_time" time without time zone, "p_end_time" time without time zone, "p_user_id" "uuid", "p_amount" numeric, "p_hold_expires_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_basket_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_is_service_role boolean;
  v_court_status text;
  v_conflict_id uuid;
  v_booking_id uuid;
  v_basket_id uuid;
  v_payment_id uuid;
  v_customer_name text;
  v_now_manila timestamp;
  v_day_of_week text;
  v_is_open boolean;
  v_open_time time;
  v_close_time time;
  v_duration_hours integer;
  v_expected_amount numeric;
  v_min_hours integer;
  v_max_hours integer;
  v_hold_expires_at timestamptz;
BEGIN
  -- 1. Evaluate caller authorization: allow signed service_role JWTs or raw console psql sessions without JWT
  v_is_service_role := (
    coalesce(auth.role(), '') = 'service_role'
    OR (session_user = 'postgres' AND auth.role() IS NULL)
  );

  -- Non-service-role callers MUST be authenticated and can only hold a slot for themselves
  IF NOT v_is_service_role THEN
    IF auth.uid() IS NULL OR coalesce(auth.role(), '') != 'authenticated' THEN
      RAISE EXCEPTION 'UNAUTHORIZED: Authentication required to reserve a court' USING ERRCODE = '42501';
    END IF;
    IF p_user_id IS NOT NULL AND p_user_id != auth.uid() THEN
      RAISE EXCEPTION 'FORBIDDEN: Cannot hold court on behalf of another player' USING ERRCODE = '42501';
    END IF;
    p_user_id := auth.uid();
  ELSE
    IF p_user_id IS NULL THEN
      RAISE EXCEPTION 'INVALID_ARGUMENT: p_user_id is required' USING ERRCODE = '22000';
    END IF;
  END IF;

  -- 2. Validate time boundaries and whole-hour increments
  IF p_start_time >= p_end_time THEN
    RAISE EXCEPTION 'INVALID_TIME_RANGE: start_time must be earlier than end_time' USING ERRCODE = '22000';
  END IF;

  IF date_part('minute', p_start_time) != 0 
     OR date_part('second', p_start_time) != 0 
     OR date_part('minute', p_end_time) != 0 
     OR date_part('second', p_end_time) != 0 THEN
    RAISE EXCEPTION 'INVALID_TIME_INCREMENT: Reservations must be booked in whole-hour increments on the hour' USING ERRCODE = '22000';
  END IF;

  -- 3. Validate duration (1 to 3 whole hours)
  v_duration_hours := (date_part('epoch', (p_end_time - p_start_time)) / 3600)::integer;
  SELECT min_hours, max_hours INTO v_min_hours, v_max_hours FROM public.booking_settings WHERE id;
  IF v_min_hours IS NULL THEN
    RAISE EXCEPTION 'PRICING_NOT_CONFIGURED: booking_settings row is missing' USING ERRCODE = 'P0001';
  END IF;
  IF v_duration_hours < v_min_hours OR v_duration_hours > v_max_hours OR (p_end_time - p_start_time) != (v_duration_hours || ' hours')::interval THEN
    RAISE EXCEPTION 'INVALID_DURATION: Booking duration must be between % and % consecutive hours', v_min_hours, v_max_hours USING ERRCODE = '22000';
  END IF;

  -- 4. Reject past dates and times in Asia/Manila timezone
  v_now_manila := timezone('Asia/Manila', now());
  IF (p_booking_date + p_start_time) <= v_now_manila THEN
    RAISE EXCEPTION 'PAST_SLOT: The requested time slot has already passed' USING ERRCODE = '22000';
  END IF;

  -- 5. Query and verify venue operating hours for the given date
  v_day_of_week := CASE date_part('dow', p_booking_date)::integer
    WHEN 0 THEN 'Sunday'
    WHEN 1 THEN 'Monday'
    WHEN 2 THEN 'Tuesday'
    WHEN 3 THEN 'Wednesday'
    WHEN 4 THEN 'Thursday'
    WHEN 5 THEN 'Friday'
    WHEN 6 THEN 'Saturday'
  END;
  SELECT is_open, open_time, close_time
  INTO v_is_open, v_open_time, v_close_time
  FROM public.operating_hours
  WHERE day_of_week = v_day_of_week;

  IF NOT FOUND OR v_is_open = false OR v_open_time IS NULL OR v_close_time IS NULL THEN
    RAISE EXCEPTION 'VENUE_CLOSED: The venue is closed on this date' USING ERRCODE = 'P0001';
  END IF;

  IF p_start_time < v_open_time OR p_end_time > v_close_time THEN
    RAISE EXCEPTION 'OUTSIDE_OPERATING_HOURS: The selected time range falls outside venue operating hours' USING ERRCODE = '22000';
  END IF;

  -- 6. Enforce server-calculated price (PHP 200 per hour flat rate; prevents underpayment bypass)
  v_expected_amount := public.quote_court_price(p_booking_date, p_start_time, p_end_time);
  IF p_amount IS NOT NULL AND p_amount != v_expected_amount THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: Expected amount of % PHP for % hour(s), but received % PHP', v_expected_amount, v_duration_hours, p_amount USING ERRCODE = '22000';
  END IF;
  p_amount := v_expected_amount;

  -- 7. Acquire exclusive row lock on the court row and verify operational status
  SELECT status INTO v_court_status
  FROM public.courts
  WHERE id = p_court_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Court does not exist' USING ERRCODE = 'P0002';
  END IF;

  IF lower(coalesce(v_court_status, '')) != 'active' THEN
    RAISE EXCEPTION 'COURT_UNAVAILABLE: Court is currently not available for reservations' USING ERRCODE = 'P0001';
  END IF;

  -- 8. Compute or validate hold expiry
  -- If caller did not provide p_hold_expires_at (legacy 6-arg caller), fallback safely to clock_timestamp() + interval '35 minutes'.
  -- This acts as a safety buffer (giving ~2 minutes of headroom beyond Stripe's 33-minute checkout lifetime)
  -- rather than an exact match, guaranteeing the database hold outlasts the Stripe checkout session.
  IF p_hold_expires_at IS NULL THEN
    v_hold_expires_at := clock_timestamp() + interval '35 minutes';
  ELSE
    v_hold_expires_at := p_hold_expires_at;
  END IF;

  -- Customers may not choose a long hold (would block the slot indefinitely) or hoard slots
  IF NOT v_is_service_role THEN
    v_hold_expires_at := least(v_hold_expires_at, clock_timestamp() + interval '40 minutes');

    -- A customer's p_basket_id is honoured only from hold_court_basket in this transaction: adding a court to an
    -- existing basket would put it on that basket's (possibly paid) Stripe session. PostgREST cannot set app.* settings.
    IF p_basket_id IS NOT NULL AND current_setting('app.hold_basket_id', true) IS DISTINCT FROM p_basket_id::text THEN
      RAISE EXCEPTION 'INVALID_ARGUMENT: p_basket_id is only accepted from hold_court_basket' USING ERRCODE = '22000';
    END IF;

    -- It may only extend the caller's own basket, on its date, with a new court
    IF p_basket_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.bookings
      WHERE basket_id = p_basket_id
        AND (user_id IS DISTINCT FROM p_user_id OR booking_date != p_booking_date OR court_id = p_court_id)
    ) THEN
      RAISE EXCEPTION 'INVALID_ARGUMENT: p_basket_id does not match this court, date and customer' USING ERRCODE = '22000';
    END IF;

    -- One open basket per customer; a legacy hold without basket_id is its own basket
    IF EXISTS (
      SELECT 1 FROM public.bookings
      WHERE user_id = p_user_id
        AND status = 'pending'
        AND coalesce(hold_expires_at, created_at + interval '35 minutes') > clock_timestamp()
        AND coalesce(basket_id, id) IS DISTINCT FROM p_basket_id
    ) THEN
      RAISE EXCEPTION 'OPEN_BASKET_EXISTS: Finish or cancel your reservation awaiting payment before starting another' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Expired holds still match the no_overlapping_active_court_bookings constraint; release them first
  PERFORM public.release_expired_court_holds(p_court_id, p_booking_date, p_start_time, p_end_time);

  -- 9. Verify no overlapping active reservation or unexpired pending hold exists on this court and date
  -- Includes checked_in and in_progress to prevent stealing active matches
  -- Expired pending holds stop blocking once their grace period ends (public.hold_release_after)
  SELECT id INTO v_conflict_id
  FROM public.bookings
  WHERE court_id = p_court_id
    AND booking_date = p_booking_date
    AND (
      status IN ('confirmed', 'checked_in', 'in_progress', 'completed')
      OR (
        status = 'pending'
        AND public.hold_release_after(hold_expires_at, created_at) > clock_timestamp()
      )
    )
    AND start_time < p_end_time
    AND end_time > p_start_time
  LIMIT 1;

  IF v_conflict_id IS NOT NULL THEN
    RAISE EXCEPTION 'SLOT_UNAVAILABLE' USING ERRCODE = 'P0001';
  END IF;

  -- 10. Retrieve player's name from profiles to ensure customer_name is populated
  SELECT full_name INTO v_customer_name FROM public.profiles WHERE id = p_user_id;

  -- 11. Create pending booking with explicit hold_expires_at
  BEGIN
    INSERT INTO public.bookings (
      user_id,
      customer_name,
      court_id,
      booking_date,
      start_time,
      end_time,
      status,
      total_amount,
      hold_expires_at,
      basket_id
    ) VALUES (
      p_user_id,
      coalesce(v_customer_name, 'Online Player'),
      p_court_id,
      p_booking_date,
      p_start_time,
      p_end_time,
      'pending',
      p_amount,
      v_hold_expires_at,
      coalesce(p_basket_id, gen_random_uuid())
    ) RETURNING id, basket_id INTO v_booking_id, v_basket_id;
  EXCEPTION WHEN exclusion_violation THEN
    -- e.g. an expired hold that could not be released because it is locked by another transaction
    RAISE EXCEPTION 'SLOT_UNAVAILABLE' USING ERRCODE = 'P0001';
  END;

  -- 12. Create pending payment (if this fails, transaction rolls back booking insert automatically)
  INSERT INTO public.payments (
    booking_id,
    amount,
    currency,
    status
  ) VALUES (
    v_booking_id,
    p_amount,
    'php',
    'pending'
  ) RETURNING id INTO v_payment_id;

  RETURN jsonb_build_object(
    'booking_id', v_booking_id,
    'payment_id', v_payment_id,
    'hold_expires_at', v_hold_expires_at,
    'amount', p_amount,
    'basket_id', v_basket_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.hold_court_booking(uuid, date, time, time, uuid, numeric, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hold_court_booking(uuid, date, time, time, uuid, numeric, timestamptz, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.hold_court_basket(p_booking_date date, p_lines jsonb, p_hold_expires_at timestamptz DEFAULT NULL) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_basket uuid := gen_random_uuid();
  v_line record;
  v_hold jsonb;
  v_items jsonb := '[]'::jsonb;
  v_total numeric := 0;
  v_expires timestamptz;
BEGIN
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_lines) = 0
     OR jsonb_array_length(p_lines) > (SELECT count(*) FROM public.courts) THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: p_lines must list between 1 and the number of courts' USING ERRCODE = '22000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_lines) e
    WHERE jsonb_typeof(e) != 'object' OR e->>'court_id' IS NULL OR e->>'start_time' IS NULL OR e->>'end_time' IS NULL
  ) THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Each line needs court_id, start_time and end_time' USING ERRCODE = '22000';
  END IF;
  IF (SELECT count(DISTINCT (e->>'court_id')::uuid) FROM jsonb_array_elements(p_lines) e) < jsonb_array_length(p_lines) THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Each court can appear once per booking' USING ERRCODE = '22000';
  END IF;

  -- Lets hold_court_booking accept v_basket for this transaction only (see its p_basket_id guard)
  PERFORM set_config('app.hold_basket_id', v_basket::text, true);

  -- Court order gives every basket the same court-row lock order, so overlapping baskets cannot deadlock
  FOR v_line IN
    SELECT (e->>'court_id')::uuid AS court_id, (e->>'start_time')::time AS start_time, (e->>'end_time')::time AS end_time, c.name AS court_name
    FROM jsonb_array_elements(p_lines) e
    LEFT JOIN public.courts c ON c.id = (e->>'court_id')::uuid
    ORDER BY 1
  LOOP
    BEGIN
      v_hold := public.hold_court_booking(
        p_court_id => v_line.court_id, p_booking_date => p_booking_date,
        p_start_time => v_line.start_time, p_end_time => v_line.end_time,
        p_user_id => auth.uid(), p_amount => NULL,
        p_hold_expires_at => p_hold_expires_at, p_basket_id => v_basket
      );
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM = 'SLOT_UNAVAILABLE' THEN
        RAISE EXCEPTION 'SLOT_UNAVAILABLE: % %–%', v_line.court_name,
          to_char(v_line.start_time, 'HH:MI AM'), to_char(v_line.end_time, 'HH:MI AM') USING ERRCODE = 'P0001';
      END IF;
      RAISE;
    END;

    v_total := v_total + (v_hold->>'amount')::numeric;
    v_expires := least(v_expires, (v_hold->>'hold_expires_at')::timestamptz);
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'booking_id', v_hold->'booking_id',
      'payment_id', v_hold->'payment_id',
      'court_id', v_line.court_id,
      'court_name', v_line.court_name,
      'start_time', v_line.start_time,
      'end_time', v_line.end_time,
      'amount', v_hold->'amount'
    ));
  END LOOP;

  PERFORM set_config('app.hold_basket_id', '', true);
  RETURN jsonb_build_object('basket_id', v_basket, 'hold_expires_at', v_expires, 'total', v_total, 'items', v_items);
END;
$$;

REVOKE ALL ON FUNCTION public.hold_court_basket(date, jsonb, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hold_court_basket(date, jsonb, timestamptz) TO authenticated, service_role;

-- Section 4: staff settle every pending court of a basket in one transaction (any court failing aborts all);
--   the settled total must equal what staff collected (p_expected_amount)
DROP FUNCTION IF EXISTS public.settle_counter_basket(uuid, text, text);

CREATE OR REPLACE FUNCTION "public"."settle_counter_basket"("p_basket_id" "uuid", "p_expected_amount" numeric, "p_payment_method" "text", "p_payment_reference" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_line record;
  v_count integer := 0;
  v_amount numeric := 0;
BEGIN
  -- Same admin rule as settle_counter_payment, checked first so a non-admin cannot probe basket ids
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'FORBIDDEN: Admin privileges required' USING ERRCODE = '42501';
  END IF;

  -- court_id order keeps lock order stable across concurrent settlements
  FOR v_line IN
    SELECT b.id AS booking_id, p.id AS payment_id, p.amount
    FROM public.bookings b
    JOIN public.payments p ON p.booking_id = b.id AND p.status = 'pending'
    WHERE b.basket_id = p_basket_id AND b.status = 'pending'
    ORDER BY b.court_id
  LOOP
    PERFORM public.settle_counter_payment(v_line.booking_id, v_line.payment_id, p_payment_method, p_payment_reference);
    v_count := v_count + 1;
    v_amount := v_amount + v_line.amount;
  END LOOP;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'NOT_FOUND: Basket % has no pending booking', p_basket_id USING ERRCODE = 'P0002';
  END IF;

  -- A court cancelled or added after staff saw the total: undo every settlement above
  IF v_amount IS DISTINCT FROM p_expected_amount THEN
    RAISE EXCEPTION 'AMOUNT_CHANGED: Basket % totals % PHP, staff expected % PHP', p_basket_id, v_amount, p_expected_amount USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object('basket_id', p_basket_id, 'settled', v_count, 'amount', v_amount);
END;
$$;

REVOKE ALL ON FUNCTION public.settle_counter_basket(uuid, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_counter_basket(uuid, numeric, text, text) TO authenticated, service_role;

-- Section 5: duplicate-payment refund key is per booking, so basket siblings sharing an intent get distinct refunds
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

-- Section 6: only the service role may change basket_id (a customer re-pointing a cancelled hold at a paid basket
--   would have it reconciled, and refunded, from that basket's Stripe intent)
CREATE OR REPLACE FUNCTION public.bookings_basket_id_immutable() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF NOT (coalesce(auth.role(), '') = 'service_role' OR (session_user = 'postgres' AND auth.role() IS NULL)) THEN
    RAISE EXCEPTION 'FORBIDDEN: basket_id cannot be changed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bookings_basket_id_immutable ON public.bookings;
CREATE TRIGGER bookings_basket_id_immutable BEFORE UPDATE ON public.bookings
  FOR EACH ROW WHEN (OLD.basket_id IS DISTINCT FROM NEW.basket_id) EXECUTE FUNCTION public.bookings_basket_id_immutable();

COMMIT;
