-- ==============================================================================
-- Migration: configurable_pricing
-- Depends on: hold_release_grace_period (hold_court_booking, create_walk_in_booking live bodies).
-- Description:
--   1. booking_settings (single row): base hourly rate and min/max booking length in whole hours.
--      Seeded with today's rules (PHP 200/hour, 1 to 3 hours) so nothing changes until an admin edits it.
--   2. peak_rates: hourly rate for chosen days and whole-hour time windows.
--   3. quote_court_price(date, start, end): each booked hour costs the highest peak rate whose window
--      contains that hour's start on that weekday, otherwise the base rate. Mirrored for display by
--      src/lib/services/pricing/quoteCourtPrice.ts.
--   4. hold_court_booking / create_walk_in_booking: duration limits and expected amount come from the
--      settings (live bodies; only those lines changed). They now also return the amount charged.
--   5. save_pricing_settings: admin-only, saves the settings and replaces all peak windows in one transaction.
--   Existing bookings keep their stored total_amount. Readable by everyone (the public grid prices slots);
--   writable only by admins / service role. Idempotent: safe to re-run.
-- ==============================================================================

BEGIN;

-- 1. Settings (exactly one row: id = true)
CREATE TABLE IF NOT EXISTS public.booking_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  base_hourly_rate numeric(10,2) NOT NULL CHECK (base_hourly_rate > 0),
  min_hours integer NOT NULL CHECK (min_hours >= 1),
  max_hours integer NOT NULL CHECK (max_hours <= 12),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT booking_settings_hours_check CHECK (max_hours >= min_hours)
);
INSERT INTO public.booking_settings (id, base_hourly_rate, min_hours, max_hours)
VALUES (true, 200, 1, 3)
ON CONFLICT (id) DO NOTHING;

-- 2. Peak windows
CREATE TABLE IF NOT EXISTS public.peak_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL DEFAULT '' CHECK (length(label) <= 60),
  days text[] NOT NULL CHECK (
    cardinality(days) > 0
    AND days <@ ARRAY['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  ),
  start_time time NOT NULL CHECK (date_part('minute', start_time) = 0 AND date_part('second', start_time) = 0),
  end_time time NOT NULL CHECK (date_part('minute', end_time) = 0 AND date_part('second', end_time) = 0),
  hourly_rate numeric(10,2) NOT NULL CHECK (hourly_rate > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT peak_rates_window_check CHECK (end_time > start_time)
);

ALTER TABLE public.booking_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE public.peak_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.peak_rates FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS booking_settings_select_policy ON public.booking_settings;
CREATE POLICY booking_settings_select_policy ON public.booking_settings FOR SELECT USING (true);
DROP POLICY IF EXISTS booking_settings_admin_policy ON public.booking_settings;
CREATE POLICY booking_settings_admin_policy ON public.booking_settings
  USING (coalesce(auth.role(), '') = 'service_role'
    OR (current_user = 'postgres' AND auth.role() IS NULL)
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (coalesce(auth.role(), '') = 'service_role'
    OR (current_user = 'postgres' AND auth.role() IS NULL)
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS peak_rates_select_policy ON public.peak_rates;
CREATE POLICY peak_rates_select_policy ON public.peak_rates FOR SELECT USING (true);
DROP POLICY IF EXISTS peak_rates_admin_policy ON public.peak_rates;
CREATE POLICY peak_rates_admin_policy ON public.peak_rates
  USING (coalesce(auth.role(), '') = 'service_role'
    OR (current_user = 'postgres' AND auth.role() IS NULL)
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (coalesce(auth.role(), '') = 'service_role'
    OR (current_user = 'postgres' AND auth.role() IS NULL)
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

REVOKE ALL ON public.booking_settings, public.peak_rates FROM anon, authenticated;
GRANT SELECT ON public.booking_settings, public.peak_rates TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.booking_settings, public.peak_rates TO authenticated;
GRANT ALL ON public.booking_settings, public.peak_rates TO service_role;

-- 3. Price quote (also used by the database functions below, so the charged amount is always this)
CREATE OR REPLACE FUNCTION public.quote_court_price(p_booking_date date, p_start_time time, p_end_time time)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_base numeric;
  v_day text := to_char(p_booking_date, 'FMDay');
  v_hours integer := (date_part('epoch', p_end_time - p_start_time) / 3600)::integer;
  v_hour time;
  v_rate numeric;
  v_total numeric := 0;
BEGIN
  SELECT base_hourly_rate INTO v_base FROM public.booking_settings WHERE id;
  IF v_base IS NULL THEN
    RAISE EXCEPTION 'PRICING_NOT_CONFIGURED: booking_settings row is missing' USING ERRCODE = 'P0001';
  END IF;

  FOR i IN 0 .. v_hours - 1 LOOP
    v_hour := p_start_time + make_interval(hours => i);
    SELECT max(hourly_rate) INTO v_rate
    FROM public.peak_rates
    WHERE v_day = ANY (days) AND start_time <= v_hour AND v_hour < end_time;
    v_total := v_total + coalesce(v_rate, v_base);
  END LOOP;

  RETURN v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.quote_court_price(date, time, time) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.quote_court_price(date, time, time) TO anon, authenticated, service_role;

-- 4. Booking functions (live bodies; duration limits and price from settings)
CREATE OR REPLACE FUNCTION "public"."hold_court_booking"("p_court_id" "uuid", "p_booking_date" "date", "p_start_time" time without time zone, "p_end_time" time without time zone, "p_user_id" "uuid", "p_amount" numeric, "p_hold_expires_at" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
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
    'hold_expires_at', v_hold_expires_at,
    'amount', p_amount
  );
END;
$$;


CREATE OR REPLACE FUNCTION "public"."create_walk_in_booking"("p_court_id" "uuid", "p_customer_name" "text", "p_booking_date" "date", "p_start_time" time without time zone, "p_end_time" time without time zone, "p_amount" numeric, "p_customer_id" "uuid" DEFAULT NULL::"uuid", "p_user_id" "uuid" DEFAULT NULL::"uuid", "p_payment_method" "text" DEFAULT NULL::"text", "p_payment_reference" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
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
  v_min_hours integer;
  v_max_hours integer;
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
  SELECT min_hours, max_hours INTO v_min_hours, v_max_hours FROM public.booking_settings WHERE id;
  IF v_min_hours IS NULL THEN
    RAISE EXCEPTION 'PRICING_NOT_CONFIGURED: booking_settings row is missing' USING ERRCODE = 'P0001';
  END IF;
  IF v_duration_hours < v_min_hours OR v_duration_hours > v_max_hours OR (p_end_time - p_start_time) != (v_duration_hours || ' hours')::interval THEN
    RAISE EXCEPTION 'INVALID_DURATION: Booking duration must be between % and % consecutive hours', v_min_hours, v_max_hours USING ERRCODE = '22000';
  END IF;

  v_expected_amount := public.quote_court_price(p_booking_date, p_start_time, p_end_time);
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

  RETURN jsonb_build_object('booking_id', v_booking_id, 'amount', p_amount);
END;
$$;


-- 5. Admin save: settings + full replacement of peak windows, atomically
CREATE OR REPLACE FUNCTION public.save_pricing_settings(
  p_base_hourly_rate numeric,
  p_min_hours integer,
  p_max_hours integer,
  p_peak_rates jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF coalesce(auth.role(), '') != 'service_role'
     AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'FORBIDDEN: Admin privileges required' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(coalesce(p_peak_rates, '[]'::jsonb)) != 'array' THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: p_peak_rates must be a JSON array' USING ERRCODE = '22000';
  END IF;

  -- Table CHECK constraints validate every value; a violation aborts the whole save
  UPDATE public.booking_settings
  SET base_hourly_rate = p_base_hourly_rate,
      min_hours = p_min_hours,
      max_hours = p_max_hours,
      updated_at = clock_timestamp(),
      updated_by = auth.uid()
  WHERE id;

  DELETE FROM public.peak_rates WHERE true;
  INSERT INTO public.peak_rates (label, days, start_time, end_time, hourly_rate)
  SELECT coalesce(r->>'label', ''),
         ARRAY(SELECT jsonb_array_elements_text(r->'days')),
         (r->>'start_time')::time,
         (r->>'end_time')::time,
         (r->>'hourly_rate')::numeric
  FROM jsonb_array_elements(coalesce(p_peak_rates, '[]'::jsonb)) AS r;

  RETURN jsonb_build_object(
    'base_hourly_rate', p_base_hourly_rate,
    'min_hours', p_min_hours,
    'max_hours', p_max_hours,
    'peak_rates', (SELECT count(*) FROM public.peak_rates)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.save_pricing_settings(numeric, integer, integer, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_pricing_settings(numeric, integer, integer, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_pricing_settings(numeric, integer, integer, jsonb) TO authenticated, service_role;

COMMIT;
