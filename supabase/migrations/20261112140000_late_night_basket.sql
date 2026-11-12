-- A basket holds one business day, including the hours it runs on past midnight (Friday open till 2 AM:
-- Friday 11 PM-12 AM and 12-2 AM pay together). Bookings still never cross midnight: an after-midnight hour is
-- stored on the next date, so each basket line may now carry its own booking_date.
--   * every line must belong to p_booking_date's business day (public.business_date)
--   * the minimum length counts a run across midnight as one (23:00-24:00 + next date 00:00-01:00 = 2 hours)
--   * overlap is per court and date
-- Rollback: supabase/rollback_late_night_basket.sql
BEGIN;

CREATE OR REPLACE FUNCTION public.hold_court_basket(p_booking_date date, p_lines jsonb, p_hold_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_basket uuid := gen_random_uuid();
  v_line record;
  v_hold jsonb;
  v_items jsonb := '[]'::jsonb;
  v_total numeric := 0;
  v_expires timestamptz;
  v_min_hours integer;
BEGIN
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_lines) = 0
     OR jsonb_array_length(p_lines) > 24 * (SELECT count(*) FROM public.courts) THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: p_lines must list between 1 and 24 times per court' USING ERRCODE = '22000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_lines) e
    WHERE jsonb_typeof(e) != 'object' OR e->>'court_id' IS NULL OR e->>'start_time' IS NULL OR e->>'end_time' IS NULL
       OR (e ? 'booking_date' AND jsonb_typeof(e->'booking_date') != 'string')
  ) THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Each line needs court_id, start_time and end_time' USING ERRCODE = '22000';
  END IF;

  -- A line's date defaults to the basket's; the business day's after-midnight hours are on the next date
  CREATE TEMP TABLE IF NOT EXISTS pg_temp.basket_lines (court_id uuid, line_date date, start_time time, end_time time) ON COMMIT DROP;
  TRUNCATE pg_temp.basket_lines;
  INSERT INTO pg_temp.basket_lines
  SELECT (e->>'court_id')::uuid, coalesce((e->>'booking_date')::date, p_booking_date), (e->>'start_time')::time, (e->>'end_time')::time
  FROM jsonb_array_elements(p_lines) e;

  IF EXISTS (SELECT 1 FROM pg_temp.basket_lines l WHERE public.business_date(l.line_date, l.start_time) IS DISTINCT FROM p_booking_date) THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: A time is not on this booking day' USING ERRCODE = '22000';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM (SELECT l.*, row_number() OVER () AS i FROM pg_temp.basket_lines l) a
    JOIN (SELECT l.*, row_number() OVER () AS j FROM pg_temp.basket_lines l) b
      ON a.i < b.j AND a.court_id = b.court_id AND a.line_date = b.line_date
     AND a.start_time < b.end_time AND b.start_time < a.end_time
  ) THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Two times on the same court overlap' USING ERRCODE = '22000';
  END IF;

  -- The minimum counts a run across midnight as one booking (hold_court_booking skips it for basket lines)
  SELECT min_hours INTO v_min_hours FROM public.booking_settings WHERE id;
  IF v_min_hours IS NULL THEN
    RAISE EXCEPTION 'PRICING_NOT_CONFIGURED: booking_settings row is missing' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_temp.basket_lines a
    WHERE extract(epoch FROM a.end_time - a.start_time) / 3600 + coalesce((
      SELECT extract(epoch FROM b.end_time - b.start_time) / 3600 FROM pg_temp.basket_lines b
      WHERE b.court_id = a.court_id
        AND ((a.end_time = '24:00' AND b.start_time = '00:00' AND b.line_date = a.line_date + 1)
          OR (a.start_time = '00:00' AND b.end_time = '24:00' AND b.line_date = a.line_date - 1))
      LIMIT 1), 0) < v_min_hours
  ) THEN
    RAISE EXCEPTION 'INVALID_DURATION: Bookings must be at least % hour(s) long', v_min_hours USING ERRCODE = '22000';
  END IF;

  -- Lets hold_court_booking accept v_basket for this transaction only (see its p_basket_id guard)
  PERFORM set_config('app.hold_basket_id', v_basket::text, true);

  -- Court, date, then start order gives every basket the same lock order, so overlapping baskets cannot deadlock
  FOR v_line IN
    SELECT l.court_id, l.line_date, l.start_time, l.end_time, c.name AS court_name
    FROM pg_temp.basket_lines l
    LEFT JOIN public.courts c ON c.id = l.court_id
    ORDER BY 1, 2, 3
  LOOP
    BEGIN
      v_hold := public.hold_court_booking(
        p_court_id => v_line.court_id, p_booking_date => v_line.line_date,
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
      'booking_date', v_line.line_date,
      'start_time', v_line.start_time,
      'end_time', v_line.end_time,
      'amount', v_hold->'amount'
    ));
  END LOOP;

  PERFORM set_config('app.hold_basket_id', '', true);
  RETURN jsonb_build_object('basket_id', v_basket, 'hold_expires_at', v_expires, 'total', v_total, 'items', v_items);
END;
$function$;

CREATE OR REPLACE FUNCTION public.hold_court_booking(p_court_id uuid, p_booking_date date, p_start_time time without time zone, p_end_time time without time zone, p_user_id uuid, p_amount numeric, p_hold_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_basket_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  -- 3. Validate duration (whole hours, at least the minimum; no maximum)
  v_duration_hours := (date_part('epoch', (p_end_time - p_start_time)) / 3600)::integer;
  SELECT min_hours, max_hours INTO v_min_hours, v_max_hours FROM public.booking_settings WHERE id;
  IF v_min_hours IS NULL THEN
    RAISE EXCEPTION 'PRICING_NOT_CONFIGURED: booking_settings row is missing' USING ERRCODE = 'P0001';
  END IF;
  IF (v_duration_hours < v_min_hours
      -- A basket checks the minimum per run (hold_court_basket), so 11 PM-12 AM and 12-1 AM on one court count as 2 hours
      AND NOT (p_basket_id IS NOT NULL AND current_setting('app.hold_basket_id', true) = p_basket_id::text))
     OR (p_end_time - p_start_time) != (v_duration_hours || ' hours')::interval THEN
    RAISE EXCEPTION 'INVALID_DURATION: Bookings must be at least % hour(s) long', v_min_hours USING ERRCODE = '22000';
  END IF;

  -- 4. Reject past dates and times in Asia/Manila timezone
  v_now_manila := timezone('Asia/Manila', now());
  IF (p_booking_date + p_start_time) <= v_now_manila THEN
    RAISE EXCEPTION 'PAST_SLOT: The requested time slot has already passed' USING ERRCODE = '22000';
  END IF;

  -- 5. Query and verify venue operating hours for the given date
  IF NOT EXISTS (SELECT 1 FROM public.bookable_windows(p_booking_date)) THEN
    RAISE EXCEPTION 'VENUE_CLOSED: The venue is closed on this date' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.within_bookable_hours(p_booking_date, p_start_time, p_end_time) THEN
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

    -- It may only extend the caller's own basket, on its booking day, with a time that doesn't overlap one already held
    IF p_basket_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.bookings
      WHERE basket_id = p_basket_id
        AND (user_id IS DISTINCT FROM p_user_id
             OR business_date IS DISTINCT FROM public.business_date(p_booking_date, p_start_time)
             OR (court_id = p_court_id AND booking_date = p_booking_date AND start_time < p_end_time AND end_time > p_start_time))
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
$function$;

COMMIT;
