-- ==============================================================================
-- Rollback: 20261102_launch_hardening.sql
-- Restores the function bodies from 20261026 / 20261027 / 20261031 and the previous
-- grants and payments constraints.
-- NOTE: re-adding payments_booking_id_key fails if duplicate-charge payment rows
-- now exist; resolve those (they carry refund_requests) before rolling back.
-- ==============================================================================

BEGIN;

DROP INDEX IF EXISTS public.uq_payments_one_pending_per_booking;
ALTER TABLE public.payments ADD CONSTRAINT payments_booking_id_key UNIQUE (booking_id);
ALTER TABLE public.payments ADD CONSTRAINT payments_stripe_payment_id_key UNIQUE (stripe_payment_id);

GRANT INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public TO anon;
GRANT TRUNCATE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.profiles TO authenticated;

CREATE OR REPLACE FUNCTION public.hold_court_booking(
  p_court_id uuid,
  p_booking_date date,
  p_start_time time,
  p_end_time time,
  p_user_id uuid,
  p_amount numeric,
  p_hold_expires_at timestamptz DEFAULT NULL
) RETURNS jsonb 
LANGUAGE plpgsql 
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_is_service_role boolean;
  v_court_status text;
  v_conflict_id uuid;
  v_booking_id uuid;
  v_payment_id uuid;
  v_customer_name text;
  v_now_manila timestamp;
  v_day_of_week text;
  v_is_open boolean;
  v_open_time time;
  v_close_time time;
  v_duration_hours integer;
  v_expected_amount numeric;
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
  IF v_duration_hours < 1 OR v_duration_hours > 3 OR (p_end_time - p_start_time) != (v_duration_hours || ' hours')::interval THEN
    RAISE EXCEPTION 'INVALID_DURATION: Booking duration must be between 1 and 3 consecutive hours' USING ERRCODE = '22000';
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
  v_expected_amount := v_duration_hours * 200;
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

  -- 9. Verify no overlapping active reservation or unexpired pending hold exists on this court and date
  -- Includes checked_in and in_progress to prevent stealing active matches
  -- Expired pending holds (hold_expires_at <= clock_timestamp()) are ignored and do NOT block new reservations
  SELECT id INTO v_conflict_id
  FROM public.bookings
  WHERE court_id = p_court_id
    AND booking_date = p_booking_date
    AND (
      status IN ('confirmed', 'checked_in', 'in_progress', 'completed')
      OR (
        status = 'pending' 
        AND coalesce(hold_expires_at, created_at + interval '35 minutes') > clock_timestamp()
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
  INSERT INTO public.bookings (
    user_id,
    customer_name,
    court_id,
    booking_date,
    start_time,
    end_time,
    status,
    total_amount,
    hold_expires_at
  ) VALUES (
    p_user_id,
    coalesce(v_customer_name, 'Online Player'),
    p_court_id,
    p_booking_date,
    p_start_time,
    p_end_time,
    'pending',
    p_amount,
    v_hold_expires_at
  ) RETURNING id INTO v_booking_id;

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
    'hold_expires_at', v_hold_expires_at
  );
END;
$$;

-- Restrict permissions: Revoke public and anon access, then grant only to authenticated and service_role
REVOKE ALL ON FUNCTION public.hold_court_booking(uuid, date, time, time, uuid, numeric, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hold_court_booking(uuid, date, time, time, uuid, numeric, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.hold_court_booking(uuid, date, time, time, uuid, numeric, timestamptz) TO authenticated, service_role;

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
  SELECT court_id, booking_date, start_time, end_time, user_id, status
  INTO v_court_id, v_booking_date, v_start_time, v_end_time, v_user_id, v_status
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
  END IF;

  IF v_status != 'pending' THEN
    RAISE EXCEPTION 'INVALID_STATUS: Booking is not pending (status: %)', v_status USING ERRCODE = '22000';
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
        AND coalesce(hold_expires_at, created_at + interval '35 minutes') > clock_timestamp()
      )
    )
    AND start_time < v_end_time
    AND end_time > v_start_time
  LIMIT 1;

  IF v_conflict_id IS NOT NULL THEN
    RAISE EXCEPTION 'SLOT_UNAVAILABLE' USING ERRCODE = 'P0001';
  END IF;

  -- 6. Lock and validate target payment row (Hierarchy Level 3)
  SELECT status INTO v_payment_status
  FROM public.payments
  WHERE id = p_payment_id AND booking_id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Payment % does not exist for booking %', p_payment_id, p_booking_id USING ERRCODE = 'P0002';
  END IF;

  IF v_payment_status != 'pending' THEN
    RAISE EXCEPTION 'INVALID_STATUS: Payment is not pending (status: %)', v_payment_status USING ERRCODE = '22000';
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

CREATE OR REPLACE FUNCTION public.create_walk_in_booking(
  p_court_id uuid,
  p_customer_name text,
  p_booking_date date,
  p_start_time time,
  p_end_time time,
  p_amount numeric,
  p_customer_id uuid DEFAULT NULL,
  p_user_id uuid DEFAULT NULL,
  p_payment_method text DEFAULT NULL,
  p_payment_reference text DEFAULT NULL
) RETURNS jsonb 
LANGUAGE plpgsql 
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_is_service_role boolean;
  v_court_status text;
  v_conflict_id uuid;
  v_booking_id uuid;
  v_payment_status text;
  v_paid_at timestamptz;
  v_now_manila timestamp;
  v_day_of_week text;
  v_is_open boolean;
  v_open_time time;
  v_close_time time;
  v_duration_hours integer;
  v_expected_amount numeric;
BEGIN
  -- 1. Evaluate caller authorization
  v_is_service_role := (
    coalesce(auth.role(), '') = 'service_role'
    OR (session_user = 'postgres' AND auth.role() IS NULL)
  );

  IF NOT v_is_service_role THEN
    IF auth.uid() IS NULL OR coalesce(auth.role(), '') != 'authenticated' THEN
      RAISE EXCEPTION 'UNAUTHORIZED: Authentication required to record walk-in reservations' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() AND role = 'admin'
    ) THEN
      RAISE EXCEPTION 'FORBIDDEN: Admin privileges required to record walk-in reservations' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 2. Validate input parameters
  IF p_start_time >= p_end_time THEN
    RAISE EXCEPTION 'INVALID_TIME_RANGE: start_time must be earlier than end_time' USING ERRCODE = '22000';
  END IF;

  IF trim(coalesce(p_customer_name, '')) = '' THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: customer_name is required' USING ERRCODE = '22000';
  END IF;

  IF (p_customer_id IS NULL AND p_user_id IS NULL) OR (p_customer_id IS NOT NULL AND p_user_id IS NOT NULL) THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Exactly one of p_customer_id or p_user_id must be provided' USING ERRCODE = '22000';
  END IF;

  IF p_payment_method IS NOT NULL AND p_payment_method NOT IN ('cash', 'gcash') THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: payment_method must be cash, gcash, or null' USING ERRCODE = '22000';
  END IF;

  IF date_part('minute', p_start_time) != 0 
     OR date_part('second', p_start_time) != 0 
     OR date_part('minute', p_end_time) != 0 
     OR date_part('second', p_end_time) != 0 THEN
    RAISE EXCEPTION 'INVALID_TIME_INCREMENT: Reservations must be booked in whole-hour increments on the hour' USING ERRCODE = '22000';
  END IF;

  v_duration_hours := (date_part('epoch', (p_end_time - p_start_time)) / 3600)::integer;
  IF v_duration_hours < 1 OR v_duration_hours > 3 OR (p_end_time - p_start_time) != (v_duration_hours || ' hours')::interval THEN
    RAISE EXCEPTION 'INVALID_DURATION: Booking duration must be between 1 and 3 consecutive hours' USING ERRCODE = '22000';
  END IF;

  v_expected_amount := v_duration_hours * 200;
  IF p_amount IS NOT NULL AND p_amount != v_expected_amount THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: Expected amount of % PHP for % hour(s), but received % PHP', v_expected_amount, v_duration_hours, p_amount USING ERRCODE = '22000';
  END IF;
  p_amount := v_expected_amount;

  -- 3. Prevent recording walk-ins for slots that have already ended
  v_now_manila := timezone('Asia/Manila', now());
  IF (p_booking_date + p_end_time) <= v_now_manila THEN
    RAISE EXCEPTION 'PAST_SLOT: The requested time slot has already ended' USING ERRCODE = '22000';
  END IF;

  -- 4. Verify operating hours
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

  -- 5. Acquire exclusive row lock on court
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

  -- 6. Check for overlapping active reservations (expired pending holds do NOT conflict)
  SELECT id INTO v_conflict_id
  FROM public.bookings
  WHERE court_id = p_court_id
    AND booking_date = p_booking_date
    AND (
      status IN ('confirmed', 'checked_in', 'in_progress', 'completed')
      OR (
        status = 'pending'
        AND coalesce(hold_expires_at, created_at + interval '35 minutes') > clock_timestamp()
      )
    )
    AND start_time < p_end_time
    AND end_time > p_start_time
  LIMIT 1;

  IF v_conflict_id IS NOT NULL THEN
    RAISE EXCEPTION 'SLOT_UNAVAILABLE' USING ERRCODE = 'P0001';
  END IF;

  -- 7. Insert confirmed booking
  INSERT INTO public.bookings (
    user_id,
    customer_id,
    customer_name,
    court_id,
    booking_date,
    start_time,
    end_time,
    status,
    total_amount
  ) VALUES (
    p_user_id,
    p_customer_id,
    trim(p_customer_name),
    p_court_id,
    p_booking_date,
    p_start_time,
    p_end_time,
    'confirmed',
    p_amount
  ) RETURNING id INTO v_booking_id;

  -- 8. Determine initial payment status
  IF p_payment_method IS NOT NULL THEN
    v_payment_status := 'paid';
    v_paid_at := now();
  ELSE
    v_payment_status := 'pending';
    v_paid_at := NULL;
  END IF;

  -- 9. Insert payment atomically with optional payment reference
  INSERT INTO public.payments (
    booking_id,
    amount,
    currency,
    status,
    payment_method,
    payment_reference,
    paid_at
  ) VALUES (
    v_booking_id,
    p_amount,
    'php',
    v_payment_status,
    p_payment_method,
    p_payment_reference,
    v_paid_at
  );

  RETURN jsonb_build_object('booking_id', v_booking_id);
END;
$$;

REVOKE ALL ON FUNCTION public.create_walk_in_booking(uuid, text, date, time, time, numeric, uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_walk_in_booking(uuid, text, date, time, time, numeric, uuid, uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_walk_in_booking(uuid, text, date, time, time, numeric, uuid, uuid, text, text) TO authenticated, service_role;

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

REVOKE ALL ON FUNCTION public.request_manual_cash_refund(uuid, uuid, numeric, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.request_manual_cash_refund(uuid, uuid, numeric, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.request_manual_cash_refund(uuid, uuid, numeric, text, text, text) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.release_expired_court_holds(uuid, date, time, time);

-- handle_new_user EXECUTE, update_updated_at search_path and the payment status data fix
-- are intentionally not reverted (they are safe and the data fix is not reversible).

COMMIT;
