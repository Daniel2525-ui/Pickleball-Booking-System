-- ==============================================================================
-- Migration: hold_release_grace_period
-- Depends on: 20261101, 20261102 (bodies below are those versions with one predicate changed).
-- Description: late-Stripe-webhook protection for expired booking holds.
--   An expired pending hold keeps blocking its slot for a 20-minute grace period before the
--   database alone (release_expired_court_holds) may cancel it for another booking.
--   20 minutes is longer than the 15-minute Supabase Cron interval, so every expired hold is
--   first seen by the Stripe-verified cleanup route (or the webhook / success-page verify),
--   which confirms a hold that was paid at the last moment instead of losing the slot.
--   The cron route itself is unchanged: it checks Stripe and cancels unpaid expired holds
--   immediately, so slots normally free within 15 minutes of expiry exactly as before.
--   Unchanged: hold length, the 40-minute customer cap, the 3-active-holds limit (still counts
--   only unexpired holds), cancel_expired_booking, reconcile_booking_payment.
-- ==============================================================================

BEGIN;

-- 1. Single definition of when an expired hold stops blocking its slot
CREATE OR REPLACE FUNCTION public.hold_release_after(p_hold_expires_at timestamptz, p_created_at timestamptz)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT coalesce(p_hold_expires_at, p_created_at + interval '35 minutes') + interval '20 minutes';
$$;

REVOKE ALL ON FUNCTION public.hold_release_after(timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hold_release_after(timestamptz, timestamptz) FROM anon, authenticated;

-- 2. release_expired_court_holds ------------------------------------------------
CREATE OR REPLACE FUNCTION public.release_expired_court_holds(
  p_court_id uuid,
  p_booking_date date,
  p_start_time time,
  p_end_time time
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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

REVOKE ALL ON FUNCTION public.release_expired_court_holds(uuid, date, time, time) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_expired_court_holds(uuid, date, time, time) FROM anon, authenticated;

-- 3. hold_court_booking -----------------------------------------------------------
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

  -- Customers may not choose a long hold (would block the slot indefinitely) or hoard slots
  IF NOT v_is_service_role THEN
    v_hold_expires_at := least(v_hold_expires_at, clock_timestamp() + interval '40 minutes');

    IF (
      SELECT count(*) FROM public.bookings
      WHERE user_id = p_user_id
        AND status = 'pending'
        AND coalesce(hold_expires_at, created_at + interval '35 minutes') > clock_timestamp()
    ) >= 3 THEN
      RAISE EXCEPTION 'TOO_MANY_HOLDS: Finish or cancel your pending reservations before holding another slot' USING ERRCODE = 'P0001';
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
    'hold_expires_at', v_hold_expires_at
  );
END;
$$;

-- Restrict permissions: Revoke public and anon access, then grant only to authenticated and service_role
REVOKE ALL ON FUNCTION public.hold_court_booking(uuid, date, time, time, uuid, numeric, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hold_court_booking(uuid, date, time, time, uuid, numeric, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.hold_court_booking(uuid, date, time, time, uuid, numeric, timestamptz) TO authenticated, service_role;

-- 4. confirm_checkout_hold -------------------------------------------------------
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
    -- Customers cannot extend their own hold indefinitely
    p_hold_expires_at := least(p_hold_expires_at, clock_timestamp() + interval '40 minutes');
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

-- 5. create_walk_in_booking -----------------------------------------------------
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

  -- Expired holds still match the no_overlapping_active_court_bookings constraint; release them first
  PERFORM public.release_expired_court_holds(p_court_id, p_booking_date, p_start_time, p_end_time);

  -- 6. Check for overlapping active reservations (expired holds past their grace period do NOT conflict)
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

  -- 7. Insert confirmed booking
  BEGIN
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
  EXCEPTION WHEN exclusion_violation THEN
    RAISE EXCEPTION 'SLOT_UNAVAILABLE' USING ERRCODE = 'P0001';
  END;

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

COMMIT;
