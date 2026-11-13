-- Self-check for walk_in_running_hour: a walk-in can be booked until its first hour ends, never after.
-- Local stack only, everything rolled back:
--   docker exec -i supabase_db_localdb psql -U postgres -v ON_ERROR_STOP=1 < tests/integration/walk-in-running-hour.sql
-- Picks the current hour, so it needs the venue open now and for the next hour; it skips with a notice otherwise.
BEGIN;

CREATE FUNCTION pg_temp.fails(p_sql text, p_code text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE p_code || '%' THEN RAISE EXCEPTION 'expected %, got "%" from: %', p_code, SQLERRM, p_sql; END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'expected % but it succeeded: %', p_code, p_sql;
END;
$$;

INSERT INTO public.customers (full_name) VALUES ('Walk-in Hour Check') RETURNING id AS cust \gset
SELECT (SELECT id FROM public.courts WHERE status = 'active' ORDER BY name LIMIT 1) AS court \gset
-- The DO block below reads these back
SELECT set_config('x.court', :'court', true), set_config('x.cust', :'cust', true) \g /dev/null

DO $$
DECLARE
  v_court uuid := current_setting('x.court')::uuid;
  v_cust uuid := current_setting('x.cust')::uuid;
  v_today date := (now() AT TIME ZONE 'Asia/Manila')::date;
  v_hour time := date_trunc('hour', now() AT TIME ZONE 'Asia/Manila')::time;
  v_res jsonb;
BEGIN
  IF v_hour < '01:00' OR v_hour > '22:00' OR NOT public.within_bookable_hours(v_today, v_hour - interval '1 hour', v_hour + interval '1 hour') THEN
    RAISE NOTICE 'skipped: the venue is not open around % today', v_hour;
    RETURN;
  END IF;
  DELETE FROM public.bookings WHERE court_id = v_court AND booking_date = v_today
    AND start_time < v_hour + interval '1 hour' AND end_time > v_hour - interval '1 hour';

  -- The hour under way (e.g. 11-12 at 11:06) is still bookable, as an upcoming booking
  v_res := public.create_walk_in_booking(v_court, 'Walk-in Hour Check', v_today, v_hour, v_hour + interval '1 hour', NULL, v_cust, NULL, 'cash');
  ASSERT (SELECT status FROM public.bookings WHERE id = (v_res ->> 'booking_id')::uuid) = 'confirmed', 'running hour is saved as confirmed';

  -- The hour before it has ended: refused, even today
  PERFORM pg_temp.fails(format('SELECT public.create_walk_in_booking(%L, ''x'', %L, %L, %L, NULL, %L, NULL, ''cash'')',
    v_court, v_today, v_hour - interval '1 hour', v_hour, v_cust), 'PAST_SLOT');
  RAISE NOTICE 'walk-in running hour: all checks passed';
END $$;

ROLLBACK;
