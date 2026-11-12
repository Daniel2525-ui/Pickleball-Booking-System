-- Self-check for booking the running hour (20261113010000_book_running_hour). Local stack only, everything rolled back:
--   docker exec -i supabase_db_localdb psql -U postgres -v ON_ERROR_STOP=1 < tests/integration/book-running-hour.sql
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
END $$;

DO $$
DECLARE
  v_c1 uuid := (SELECT id FROM public.courts WHERE status = 'active' ORDER BY name LIMIT 1);
  v_player uuid := (SELECT id FROM public.profiles WHERE role <> 'admin' LIMIT 1);
  v_now timestamp := timezone('Asia/Manila', now());
  v_today date := v_now::date;
  v_hour time := date_trunc('hour', v_now)::time;  -- the hour running now
  v_hold jsonb;
  v_res jsonb;
BEGIN
  IF v_hour = '00:00' THEN RAISE NOTICE 'book-running-hour: skipped in the midnight hour (no earlier hour today)'; RETURN; END IF;
  DELETE FROM public.refund_requests; DELETE FROM public.payments; DELETE FROM public.bookings;
  DELETE FROM public.open_play_sessions; DELETE FROM public.peak_rates; DELETE FROM public.venue_closures; DELETE FROM public.court_blocks;
  UPDATE public.booking_settings SET min_hours = 1, day_ends_at = '00:00';
  UPDATE public.operating_hours SET is_open = true, open_time = '00:00', close_time = '00:00';  -- open all day

  -- 1. The running hour can be held; the hour before it cannot
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  v_hold := public.hold_court_booking(v_c1, v_today, v_hour, CASE WHEN v_hour = '23:00' THEN '24:00'::time ELSE v_hour + interval '1 hour' END, v_player, NULL);
  PERFORM pg_temp.fails(format('SELECT public.hold_court_booking(%L, %L, %L, %L, %L, NULL)',
    v_c1, v_today, v_hour - interval '1 hour', v_hour, v_player), 'PAST_SLOT');

  -- 2. Paying for it now confirms it instead of refunding it as "start passed"
  v_res := public.reconcile_booking_payment((v_hold->>'booking_id')::uuid, (v_hold->>'payment_id')::uuid,
    'cs_test_running_hour', 'pi_test_running_hour', (v_hold->>'amount')::numeric, 'php');
  ASSERT v_res->>'action' IS DISTINCT FROM 'REFUND_SCHEDULED', format('running hour was refunded: %s', v_res);
  ASSERT (SELECT status FROM public.bookings WHERE id = (v_hold->>'booking_id')::uuid) = 'confirmed', format('not confirmed: %s', v_res);

  RAISE NOTICE 'book-running-hour: all checks passed';
END $$;

ROLLBACK;
