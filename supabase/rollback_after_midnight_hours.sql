-- Rollback for *_after_midnight_hours.sql: restores the single-day operating_hours checks in hold_court_booking,
-- create_walk_in_booking, move_booking and generate_open_play_sessions, then drops the shared rule and the cutoff.
-- Before running: set every operating_hours row back to close_time > open_time, and move or cancel bookings
-- that start before opening or end at 24:00; the old checks do not understand them.
BEGIN;
DO $mig$
DECLARE
  f text;
  d text;
  n text;
  v_days constant text := $q$v_day_of_week := CASE date_part('dow', p_booking_date)::integer
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

  IF NOT FOUND OR v_is_open = false OR v_open_time IS NULL OR v_close_time IS NULL THEN$q$;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.hold_court_booking(uuid,date,time,time,uuid,numeric,timestamptz,uuid)',
    'public.create_walk_in_booking(uuid,text,date,time,time,numeric,uuid,uuid,text,text)'
  ] LOOP
    d := pg_get_functiondef(f::regprocedure);
    n := replace(d, 'IF NOT EXISTS (SELECT 1 FROM public.bookable_windows(p_booking_date)) THEN', v_days);
    n := replace(n, 'IF NOT public.within_bookable_hours(p_booking_date, p_start_time, p_end_time) THEN',
      'IF p_start_time < v_open_time OR p_end_time > v_close_time THEN');
    IF n = d OR n LIKE '%bookable%' THEN RAISE EXCEPTION 'rollback_after_midnight_hours: nothing to restore in %', f; END IF;
    EXECUTE n;
  END LOOP;

  f := 'public.move_booking(uuid,uuid,date,time)';
  d := pg_get_functiondef(f::regprocedure);
  n := regexp_replace(d, '\s*IF v_end = ''00:00'' THEN v_end := ''24:00''; END IF;', '');
  n := replace(n, 'IF NOT EXISTS (SELECT 1 FROM public.bookable_windows(p_booking_date)) THEN',
    $q$v_day := trim(to_char(p_booking_date, 'Day'));
  SELECT is_open, open_time, close_time INTO v_is_open, v_open, v_close
  FROM public.operating_hours WHERE day_of_week = v_day;
  IF NOT FOUND OR NOT v_is_open OR v_open IS NULL OR v_close IS NULL THEN$q$);
  n := replace(n, 'IF NOT public.within_bookable_hours(p_booking_date, p_start_time, v_end) THEN',
    'IF p_start_time < v_open OR v_end > v_close THEN');
  IF n = d OR n LIKE '%bookable%' THEN RAISE EXCEPTION 'rollback_after_midnight_hours: nothing to restore in %', f; END IF;
  EXECUTE n;

  f := 'public.generate_open_play_sessions(integer)';
  d := pg_get_functiondef(f::regprocedure);
  n := replace(d, 'IF NOT public.within_bookable_hours(r.d, r.start_time, r.end_time) THEN',
    $q$SELECT is_open, open_time, close_time INTO v_open, v_from, v_to
    FROM public.operating_hours WHERE day_of_week = r.day_of_week;
    IF NOT coalesce(v_open, false) OR v_from IS NULL OR v_to IS NULL
       OR r.start_time < v_from OR r.end_time > v_to THEN$q$);
  IF n = d THEN RAISE EXCEPTION 'rollback_after_midnight_hours: nothing to restore in %', f; END IF;
  EXECUTE n;
END
$mig$;

DROP FUNCTION IF EXISTS public.within_bookable_hours(date, time, time);
DROP FUNCTION IF EXISTS public.bookable_windows(date);
ALTER TABLE public.booking_settings DROP COLUMN IF EXISTS day_ends_at;
COMMIT;
