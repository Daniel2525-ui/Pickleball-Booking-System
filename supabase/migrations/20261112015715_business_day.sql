-- After-midnight operating hours, phases 2-3: the business day.
--
-- A booking keeps its real calendar date (20261112015645). Hours before booking_settings.day_ends_at belong to
-- the previous day's business: Saturday 1 AM is "Friday late night". bookings.business_date stores that day so
-- the dashboard, reports, closures and pricing all agree on it:
--   - a closed date closes its own late-night hours, not the ones left over from the night before
--   - a peak rate for Friday covers Friday's late-night hours
--   - reports and "today" count late-night bookings and payments on the day that sold them
-- Functions are edited in place (as in 20261106142829); each edit must match or the migration fails and
-- changes nothing.
-- Rollback: supabase/rollback_business_day.sql

BEGIN;

CREATE OR REPLACE FUNCTION public.business_date(p_date date, p_time time)
RETURNS date
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT CASE WHEN p_time < (SELECT day_ends_at FROM public.booking_settings WHERE id) THEN p_date - 1 ELSE p_date END;
$$;

-- The business day an instant falls on, in venue time (now() at 1 AM Saturday is Friday)
CREATE OR REPLACE FUNCTION public.business_day_of(p_at timestamptz)
RETURNS date
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT ((p_at AT TIME ZONE 'Asia/Manila') - (SELECT day_ends_at FROM public.booking_settings WHERE id))::date;
$$;

REVOKE ALL ON FUNCTION public.business_date(date, time), public.business_day_of(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.business_date(date, time), public.business_day_of(timestamptz)
  TO anon, authenticated, service_role;

-- 1. bookings.business_date, kept by a trigger (a generated column cannot read booking_settings)
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS business_date date;

CREATE OR REPLACE FUNCTION public.set_booking_business_date()
RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  NEW.business_date := public.business_date(NEW.booking_date, NEW.start_time);
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_booking_business_date() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS bookings_set_business_date ON public.bookings;
CREATE TRIGGER bookings_set_business_date
  BEFORE INSERT OR UPDATE OF booking_date, start_time, business_date ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.set_booking_business_date();

-- Backfill without touching updated_at or the history log
ALTER TABLE public.bookings DISABLE TRIGGER USER;
UPDATE public.bookings SET business_date = public.business_date(booking_date, start_time);
ALTER TABLE public.bookings ENABLE TRIGGER USER;
ALTER TABLE public.bookings ALTER COLUMN business_date SET NOT NULL;
CREATE INDEX IF NOT EXISTS bookings_business_date_idx ON public.bookings (business_date);

-- Moving the cutoff moves which day late-night bookings belong to
CREATE OR REPLACE FUNCTION public.refresh_business_dates()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  UPDATE public.bookings SET business_date = public.business_date(booking_date, start_time)
  WHERE business_date IS DISTINCT FROM public.business_date(booking_date, start_time);
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.refresh_business_dates() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS booking_settings_refresh_business_dates ON public.booking_settings;
CREATE TRIGGER booking_settings_refresh_business_dates
  AFTER UPDATE OF day_ends_at ON public.booking_settings
  FOR EACH ROW WHEN (OLD.day_ends_at IS DISTINCT FROM NEW.day_ends_at)
  EXECUTE FUNCTION public.refresh_business_dates();

-- 2. Functions that asked "which day is this?"
DO $mig$
DECLARE
  f text;
  d text;
  n text;
BEGIN
  -- Closed dates close their business day
  f := 'public.block_closed_date_booking()';
  d := pg_get_functiondef(f::regprocedure);
  n := replace(d, 'closed_on = NEW.booking_date', 'closed_on = public.business_date(NEW.booking_date, NEW.start_time)');
  IF n = d THEN RAISE EXCEPTION 'business_day: closure check not found in %', f; END IF;
  EXECUTE n;

  f := 'public.get_open_play_sessions(date,date)';
  d := pg_get_functiondef(f::regprocedure);
  n := replace(d, 'v.closed_on = s.session_date', 'v.closed_on = public.business_date(s.session_date, s.start_time)');
  IF n = d THEN RAISE EXCEPTION 'business_day: closure check not found in %', f; END IF;
  EXECUTE n;

  -- Peak rates follow the business day: Friday's rate covers Friday's late-night hours
  f := 'public.quote_court_price(date,time,time)';
  d := pg_get_functiondef(f::regprocedure);
  n := replace(d, 'WHERE v_day = ANY (days)', $q$WHERE to_char(public.business_date(p_booking_date, v_hour), 'FMDay') = ANY (days)$q$);
  IF n = d THEN RAISE EXCEPTION 'business_day: weekday match not found in %', f; END IF;
  EXECUTE n;

  -- A walk-in that already ended can be recorded for today's business day (so at 1 AM, tonight still counts)
  f := 'public.create_walk_in_booking(uuid,text,date,time,time,numeric,uuid,uuid,text,text)';
  d := pg_get_functiondef(f::regprocedure);
  n := replace(d, 'AND p_booking_date <> v_now_manila::date THEN',
    'AND public.business_date(p_booking_date, p_start_time) <> public.business_day_of(now()) THEN');
  IF n = d THEN RAISE EXCEPTION 'business_day: today check not found in %', f; END IF;
  EXECUTE n;

  -- Reports: bookings by business date, payments by the business day they were taken
  FOREACH f IN ARRAY ARRAY['public.venue_report_window(date,date)', 'public.get_venue_report(date,date)'] LOOP
    d := pg_get_functiondef(f::regprocedure);
    n := replace(d, 'booking_date', 'business_date');
    IF n = d THEN RAISE EXCEPTION 'business_day: booking_date not found in %', f; END IF;
    d := n;
    n := regexp_replace(d, '\(((?:p\.)?paid_at) AT TIME ZONE ''Asia/Manila''\)::date', 'public.business_day_of(\1)', 'g');
    IF n = d THEN RAISE EXCEPTION 'business_day: paid_at date not found in %', f; END IF;
    n := replace(n, $q$(now() AT TIME ZONE 'Asia/Manila')::date$q$, 'public.business_day_of(now())');

    IF f LIKE '%get_venue_report%' THEN
      -- Occupancy runs on one clock per business day: a 2 AM close is hour 26, and late-night bookings shift by a day
      d := n;
      n := replace(d, $q$CASE WHEN h.close_time = '00:00' THEN 24 ELSE extract(hour FROM h.close_time)::int END AS close_h$q$,
        $q$extract(hour FROM h.close_time)::int + CASE WHEN h.close_time <= h.open_time THEN 24 ELSE 0 END AS close_h$q$);
      IF n = d THEN RAISE EXCEPTION 'business_day: closing hour not found in %', f; END IF;
      d := n;
      n := replace(d, $q$b.start_time - time '00:00' AS s,$q$,
        $q$b.start_time - time '00:00' + make_interval(days => b.booking_date - b.business_date) AS s,$q$);
      IF n = d THEN RAISE EXCEPTION 'business_day: booking start not found in %', f; END IF;
      d := n;
      n := replace(d, $q$ELSE b.end_time - time '00:00' END AS e$q$,
        $q$ELSE b.end_time - time '00:00' END + make_interval(days => b.booking_date - b.business_date) AS e$q$);
      IF n = d THEN RAISE EXCEPTION 'business_day: booking end not found in %', f; END IF;
      d := n;
      n := replace(d, 'generate_series(0, 23) hr', 'generate_series(0, 35) hr');
      IF n = d THEN RAISE EXCEPTION 'business_day: hour series not found in %', f; END IF;
    END IF;
    EXECUTE n;
  END LOOP;
END
$mig$;

COMMIT;
