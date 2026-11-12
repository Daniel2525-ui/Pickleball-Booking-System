-- Rollback for *_business_day.sql: closures, pricing, the walk-in "today" check and reports go back to the
-- calendar date, then bookings.business_date and its helpers are dropped.
-- Run before rollback_after_midnight_hours.sql. The app code of the same release reads business_date, so
-- roll the app back first.
BEGIN;
DO $mig$
DECLARE
  f text;
  d text;
  n text;
BEGIN
  f := 'public.block_closed_date_booking()';
  d := pg_get_functiondef(f::regprocedure);
  n := replace(d, 'closed_on = public.business_date(NEW.booking_date, NEW.start_time)', 'closed_on = NEW.booking_date');
  IF n = d THEN RAISE EXCEPTION 'rollback_business_day: nothing to restore in %', f; END IF;
  EXECUTE n;

  f := 'public.get_open_play_sessions(date,date)';
  d := pg_get_functiondef(f::regprocedure);
  n := replace(d, 'v.closed_on = public.business_date(s.session_date, s.start_time)', 'v.closed_on = s.session_date');
  IF n = d THEN RAISE EXCEPTION 'rollback_business_day: nothing to restore in %', f; END IF;
  EXECUTE n;

  f := 'public.quote_court_price(date,time,time)';
  d := pg_get_functiondef(f::regprocedure);
  n := replace(d, $q$WHERE to_char(public.business_date(p_booking_date, v_hour), 'FMDay') = ANY (days)$q$, 'WHERE v_day = ANY (days)');
  IF n = d THEN RAISE EXCEPTION 'rollback_business_day: nothing to restore in %', f; END IF;
  EXECUTE n;

  f := 'public.create_walk_in_booking(uuid,text,date,time,time,numeric,uuid,uuid,text,text)';
  d := pg_get_functiondef(f::regprocedure);
  n := replace(d, 'AND public.business_date(p_booking_date, p_start_time) <> public.business_day_of(now()) THEN',
    'AND p_booking_date <> v_now_manila::date THEN');
  IF n = d THEN RAISE EXCEPTION 'rollback_business_day: nothing to restore in %', f; END IF;
  EXECUTE n;

  FOREACH f IN ARRAY ARRAY['public.venue_report_window(date,date)', 'public.get_venue_report(date,date)'] LOOP
    d := pg_get_functiondef(f::regprocedure);
    n := replace(d, $q$ + make_interval(days => b.booking_date - b.business_date)$q$, '');
    n := replace(n, $q$extract(hour FROM h.close_time)::int + CASE WHEN h.close_time <= h.open_time THEN 24 ELSE 0 END AS close_h$q$,
      $q$CASE WHEN h.close_time = '00:00' THEN 24 ELSE extract(hour FROM h.close_time)::int END AS close_h$q$);
    n := replace(n, 'generate_series(0, 35) hr', 'generate_series(0, 23) hr');
    n := replace(n, 'business_date', 'booking_date');
    n := replace(n, 'public.business_day_of(now())', $q$(now() AT TIME ZONE 'Asia/Manila')::date$q$);
    n := regexp_replace(n, 'public\.business_day_of\(((?:p\.)?paid_at)\)', $q$(\1 AT TIME ZONE 'Asia/Manila')::date$q$, 'g');
    IF n = d OR n LIKE '%business_da%' THEN RAISE EXCEPTION 'rollback_business_day: could not restore %', f; END IF;
    EXECUTE n;
  END LOOP;
END
$mig$;

DROP TRIGGER IF EXISTS booking_settings_refresh_business_dates ON public.booking_settings;
DROP TRIGGER IF EXISTS bookings_set_business_date ON public.bookings;
DROP FUNCTION IF EXISTS public.refresh_business_dates();
DROP FUNCTION IF EXISTS public.set_booking_business_date();
ALTER TABLE public.bookings DROP COLUMN IF EXISTS business_date;
DROP FUNCTION IF EXISTS public.business_day_of(timestamptz);
DROP FUNCTION IF EXISTS public.business_date(date, time);
COMMIT;
