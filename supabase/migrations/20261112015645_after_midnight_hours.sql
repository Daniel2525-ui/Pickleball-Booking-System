-- After-midnight operating hours, phase 1: a day's hours may close after midnight (Fri 8 AM -> 2 AM).
--
-- operating_hours keeps its shape. close_time <= open_time now means "closes on the next calendar day"
-- (close 00:00 = midnight, close 02:00 = 2 AM the next morning).
-- Bookings stay on their real calendar date and never cross midnight: 11 PM-12 AM is stored as 23:00-24:00 on
-- Friday, 12-1 AM as 00:00-01:00 on Saturday. The exclusion constraint and hold expiry are untouched.
-- booking_settings.day_ends_at is the business-day cutoff: hours before it belong to the previous day. Here it
-- only bounds how late a day may close (checked by the hours editor); reports and labels use it in later phases.
--
-- One rule, public.bookable_windows, replaces the four separate operating_hours checks. Those functions are
-- edited in place (as in 20261106142829) so nothing else in them changes; each edit must match or the
-- migration fails and changes nothing.
-- Rollback: supabase/rollback_after_midnight_hours.sql

BEGIN;

ALTER TABLE public.booking_settings ADD COLUMN IF NOT EXISTS day_ends_at time NOT NULL DEFAULT '04:00';
ALTER TABLE public.booking_settings DROP CONSTRAINT IF EXISTS booking_settings_day_ends_at_check;
ALTER TABLE public.booking_settings ADD CONSTRAINT booking_settings_day_ends_at_check
  CHECK (date_part('minute', day_ends_at) = 0 AND date_part('second', day_ends_at) = 0 AND day_ends_at <= '12:00');

-- The times that can be booked on one calendar date: the late-night tail of the previous day's hours
-- (00:00 until its closing), then this day's own hours (until closing, or 24:00 when it closes after midnight).
CREATE OR REPLACE FUNCTION public.bookable_windows(p_date date)
RETURNS TABLE (start_time time, end_time time)
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT '00:00'::time, h.close_time
  FROM public.operating_hours h
  WHERE h.day_of_week = to_char(p_date - 1, 'FMDay') AND h.is_open
    AND h.close_time <= h.open_time AND h.close_time > '00:00'
  UNION ALL
  SELECT h.open_time, CASE WHEN h.close_time <= h.open_time THEN '24:00'::time ELSE h.close_time END
  FROM public.operating_hours h
  WHERE h.day_of_week = to_char(p_date, 'FMDay') AND h.is_open
    AND h.open_time IS NOT NULL AND h.close_time IS NOT NULL;
$$;

-- A slot is bookable only when one window holds all of it, so 1-2 AM can never join 8-9 AM.
-- shortcut: a venue open 24 hours cannot book across its day cutoff in one slot, split the rule if one asks.
CREATE OR REPLACE FUNCTION public.within_bookable_hours(p_date date, p_start time, p_end time)
RETURNS boolean
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.bookable_windows(p_date) w
    WHERE p_start >= w.start_time AND p_end <= w.end_time
  );
$$;

-- Opening hours are public (operating_hours is readable by everyone), so these are too
REVOKE ALL ON FUNCTION public.bookable_windows(date), public.within_bookable_hours(date, time, time) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bookable_windows(date), public.within_bookable_hours(date, time, time)
  TO anon, authenticated, service_role;

DO $mig$
DECLARE
  f text;
  d text;
  n text;
  v_check constant text := $q$IF NOT EXISTS (SELECT 1 FROM public.bookable_windows(p_booking_date)) THEN
    RAISE EXCEPTION 'VENUE_CLOSED: The venue is closed on this date' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.within_bookable_hours(p_booking_date, p_start_time, p_end_time) THEN
    RAISE EXCEPTION 'OUTSIDE_OPERATING_HOURS: The selected time range falls outside venue operating hours' USING ERRCODE = '22000';
  END IF;$q$;
BEGIN
  -- Online holds and walk-ins: same block in both
  FOREACH f IN ARRAY ARRAY[
    'public.hold_court_booking(uuid,date,time,time,uuid,numeric,timestamptz,uuid)',
    'public.create_walk_in_booking(uuid,text,date,time,time,numeric,uuid,uuid,text,text)'
  ] LOOP
    d := pg_get_functiondef(f::regprocedure);
    n := regexp_replace(d, 'v_day_of_week := CASE.*?OUTSIDE_OPERATING_HOURS[^;]*;\s*END IF;', v_check);
    IF n = d OR n LIKE '%public.operating_hours%' THEN RAISE EXCEPTION 'after_midnight_hours: hours check not found in %', f; END IF;
    EXECUTE n;
  END LOOP;

  -- Moving a booking: time + interval wraps at midnight, so a slot ending exactly at midnight reads as 00:00
  f := 'public.move_booking(uuid,uuid,date,time)';
  d := pg_get_functiondef(f::regprocedure);
  n := replace(d,
    'v_end := p_start_time + (v_booking.end_time - v_booking.start_time);',
    $q$v_end := p_start_time + (v_booking.end_time - v_booking.start_time);
  IF v_end = '00:00' THEN v_end := '24:00'; END IF;$q$);
  IF n = d THEN RAISE EXCEPTION 'after_midnight_hours: end time not found in %', f; END IF;
  d := n;
  n := regexp_replace(d, 'v_day := trim.*?OUTSIDE_OPERATING_HOURS: The new time is outside opening hours[^;]*;\s*END IF;',
    $q$IF NOT EXISTS (SELECT 1 FROM public.bookable_windows(p_booking_date)) THEN
    RAISE EXCEPTION 'VENUE_CLOSED: The venue is closed on that day' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.within_bookable_hours(p_booking_date, p_start_time, v_end) THEN
    RAISE EXCEPTION 'OUTSIDE_OPERATING_HOURS: The new time is outside opening hours' USING ERRCODE = '22000';
  END IF;$q$);
  IF n = d OR n LIKE '%public.operating_hours%' THEN RAISE EXCEPTION 'after_midnight_hours: hours check not found in %', f; END IF;
  EXECUTE n;

  -- Open play generator: a schedule outside the hours is flagged "Venue closed", as before
  f := 'public.generate_open_play_sessions(integer)';
  d := pg_get_functiondef(f::regprocedure);
  n := regexp_replace(d, 'SELECT is_open, open_time, close_time INTO v_open.*?r\.end_time > v_to THEN',
    'IF NOT public.within_bookable_hours(r.d, r.start_time, r.end_time) THEN');
  IF n = d OR n LIKE '%public.operating_hours%' THEN RAISE EXCEPTION 'after_midnight_hours: hours check not found in %', f; END IF;
  EXECUTE n;
END
$mig$;

COMMIT;
