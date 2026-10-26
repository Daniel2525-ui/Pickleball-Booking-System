-- ==============================================================================
-- Migration: 20261026_stage1_hold_expiry_and_checkout_compatibility.sql
-- Description: Stage 1 Hold Expiry & Checkout Compatibility
--              1. Adds nullable hold_expires_at column to public.bookings.
--              2. Backfills existing pending bookings with safe 35-minute expiry buffer.
--              3. Drops legacy 6-parameter hold_court_booking to prevent PostgREST
--                 PGRST203 candidate function ambiguity.
--              4. Deploys single 7-parameter hold_court_booking with DEFAULT NULL,
--                 providing a 35-minute safety buffer for legacy 6-arg callers
--                 rather than an exact match to Stripe's session expiry, ensuring
--                 the database hold never expires before Stripe's checkout session.
--              5. Adds atomic confirm_checkout_hold RPC to prevent expired-hold
--                 resurrection and atomically persist session ID and hold deadline.
--              6. Updates conflict detection so expired pending holds do not block
--                 new reservations.
-- SCOPE NOTE: Expired-hold handling for staff walk-ins (create_walk_in_booking)
--             is intentionally scoped for Stage 2.
-- Safety: Non-destructive, backward-compatible with 6-arg callers.
-- ==============================================================================

BEGIN;

-- 1. Add hold_expires_at column if not already present
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS hold_expires_at timestamptz DEFAULT NULL;

-- Ensure payments table has stripe_session_id column if not already present
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS stripe_session_id text DEFAULT NULL;

-- 2. Backfill existing pending bookings (only active pending holds; non-pending remains NULL)
UPDATE public.bookings
SET hold_expires_at = created_at + interval '35 minutes'
WHERE status = 'pending' AND hold_expires_at IS NULL;

-- 3. Drop existing 6-parameter function overload to prevent PostgREST PGRST203 ambiguity
DROP FUNCTION IF EXISTS public.hold_court_booking(uuid, date, time, time, uuid, numeric);

-- 4. Create single 7-parameter hold_court_booking with DEFAULT NULL
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

-- 5. Create atomic confirm_checkout_hold function to coordinate post-Stripe session creation
-- Prevents expired-hold resurrection by checking for conflicts under court FOR UPDATE lock
-- and atomically persisting both hold_expires_at and stripe_session_id in a single transaction.
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

COMMIT;
