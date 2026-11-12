-- Self-check for a basket holding its day's after-midnight hours (20261112140000_late_night_basket). Local stack only,
-- everything rolled back:
--   docker exec -i supabase_db_localdb psql -U postgres -v ON_ERROR_STOP=1 < tests/integration/late-night-basket.sql
BEGIN;

-- Runs a statement that must fail with an error starting with p_code
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
  v_c2 uuid := (SELECT id FROM public.courts WHERE status = 'active' ORDER BY name OFFSET 1 LIMIT 1);
  v_c3 uuid := (SELECT id FROM public.courts WHERE status = 'active' ORDER BY name OFFSET 2 LIMIT 1);
  v_player uuid := (SELECT id FROM public.profiles WHERE role <> 'admin' LIMIT 1);
  -- Next week's Friday and the dates around it, so nothing is in the past
  v_fri date := date_trunc('week', timezone('Asia/Manila', now()))::date + 11;
  v_sat date := v_fri + 1;
  v_sun date := v_fri + 2;
  v_basket text := 'SELECT public.hold_court_basket(%L, %L::jsonb)';
  v_res jsonb;
BEGIN
  DELETE FROM public.refund_requests; DELETE FROM public.payments; DELETE FROM public.bookings;
  DELETE FROM public.open_play_sessions; DELETE FROM public.open_play_schedules;
  DELETE FROM public.peak_rates; DELETE FROM public.venue_closures; DELETE FROM public.court_blocks;
  UPDATE public.booking_settings SET min_hours = 2, day_ends_at = '04:00';
  UPDATE public.operating_hours SET is_open = true, open_time = '08:00', close_time = '22:00';
  UPDATE public.operating_hours SET open_time = '20:00', close_time = '02:00' WHERE day_of_week = 'Friday';  -- 8 PM-2 AM
  -- A peak on Saturday 12-2 AM must not apply: those hours are Friday's
  INSERT INTO public.peak_rates (label, days, start_time, end_time, hourly_rate)
  VALUES ('Saturday early', ARRAY['Saturday'], '00:00', '04:00', 999);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_player, 'role', 'authenticated')::text, true);

  -- 1. Friday 11 PM-1 AM on one court: two stored bookings, one basket, Friday's rates on both
  v_res := public.hold_court_basket(v_fri, jsonb_build_array(
    jsonb_build_object('court_id', v_c1, 'start_time', '23:00', 'end_time', '24:00'),
    jsonb_build_object('court_id', v_c1, 'booking_date', v_sat, 'start_time', '00:00', 'end_time', '01:00')));
  ASSERT jsonb_array_length(v_res->'items') = 2, 'two stored bookings';
  ASSERT (SELECT count(DISTINCT basket_id) FROM public.bookings WHERE user_id = v_player) = 1, 'one basket';
  ASSERT (SELECT array_agg(booking_date || ' ' || start_time || '-' || end_time ORDER BY booking_date)
          FROM public.bookings WHERE user_id = v_player) = ARRAY[v_fri || ' 23:00:00-24:00:00', v_sat || ' 00:00:00-01:00:00'], 'stored on their real dates';
  ASSERT NOT EXISTS (SELECT 1 FROM public.bookings WHERE user_id = v_player AND business_date <> v_fri), 'both are Friday''s';
  ASSERT (v_res->>'total')::numeric = public.quote_court_price(v_fri, '23:00', '24:00') + public.quote_court_price(v_sat, '00:00', '01:00'), 'priced per stored part';
  ASSERT (v_res->>'total')::numeric < 999, 'Saturday''s peak does not reach Friday night';
  ASSERT (SELECT array_agg(i->>'booking_date' ORDER BY i->>'booking_date') FROM jsonb_array_elements(v_res->'items') i) = ARRAY[v_fri::text, v_sat::text], 'items carry their dates';
  DELETE FROM public.payments WHERE booking_id IN (SELECT id FROM public.bookings WHERE user_id = v_player);
  DELETE FROM public.bookings WHERE user_id = v_player;

  -- 2. One after-midnight hour alone is under the 2-hour minimum, on its own or beside another court's hour
  PERFORM pg_temp.fails(format(v_basket, v_fri, jsonb_build_array(
    jsonb_build_object('court_id', v_c2, 'booking_date', v_sat, 'start_time', '00:00', 'end_time', '01:00'))), 'INVALID_DURATION');
  PERFORM pg_temp.fails(format(v_basket, v_fri, jsonb_build_array(
    jsonb_build_object('court_id', v_c1, 'start_time', '23:00', 'end_time', '24:00'),
    jsonb_build_object('court_id', v_c2, 'booking_date', v_sat, 'start_time', '00:00', 'end_time', '01:00'))), 'INVALID_DURATION');

  -- 3. Friday night's hours can't be booked as Saturday's own, and a basket can't reach two days on
  PERFORM pg_temp.fails(format(v_basket, v_sat, jsonb_build_array(
    jsonb_build_object('court_id', v_c2, 'start_time', '00:00', 'end_time', '02:00'))), 'INVALID_ARGUMENT');
  PERFORM pg_temp.fails(format(v_basket, v_fri, jsonb_build_array(
    jsonb_build_object('court_id', v_c2, 'booking_date', v_sun, 'start_time', '08:00', 'end_time', '10:00'))), 'INVALID_ARGUMENT');
  -- Saturday's own morning is not part of Friday's booking day either
  PERFORM pg_temp.fails(format(v_basket, v_fri, jsonb_build_array(
    jsonb_build_object('court_id', v_c2, 'booking_date', v_sat, 'start_time', '08:00', 'end_time', '10:00'))), 'INVALID_ARGUMENT');

  -- 4. Overlap is per court and date: the same clock hours on two dates are fine, on one date they are not
  PERFORM pg_temp.fails(format(v_basket, v_fri, jsonb_build_array(
    jsonb_build_object('court_id', v_c2, 'booking_date', v_sat, 'start_time', '00:00', 'end_time', '02:00'),
    jsonb_build_object('court_id', v_c2, 'booking_date', v_sat, 'start_time', '01:00', 'end_time', '02:00'))), 'INVALID_ARGUMENT');
  UPDATE public.booking_settings SET min_hours = 1;
  v_res := public.hold_court_basket(v_fri, jsonb_build_array(
    jsonb_build_object('court_id', v_c2, 'start_time', '20:00', 'end_time', '21:00'),
    jsonb_build_object('court_id', v_c2, 'booking_date', v_sat, 'start_time', '01:00', 'end_time', '02:00')));
  ASSERT jsonb_array_length(v_res->'items') = 2, 'separate times on one court across midnight';
  DELETE FROM public.payments WHERE booking_id IN (SELECT id FROM public.bookings WHERE user_id = v_player);
  DELETE FROM public.bookings WHERE user_id = v_player;
  UPDATE public.booking_settings SET min_hours = 2;

  -- 5. Outside a basket the minimum still applies to each booking
  PERFORM pg_temp.fails(format('SELECT public.hold_court_booking(%L, %L, %L, %L, %L, NULL)', v_c3, v_sat, '00:00', '01:00', v_player), 'INVALID_DURATION');

  -- 6. A plain one-date basket works as before
  v_res := public.hold_court_basket(v_fri, jsonb_build_array(jsonb_build_object('court_id', v_c3, 'start_time', '22:00', 'end_time', '24:00')));
  ASSERT jsonb_array_length(v_res->'items') = 1 AND v_res->'items'->0->>'booking_date' = v_fri::text, 'single-date basket';

  RAISE NOTICE 'late-night basket: all checks passed';
END $$;

ROLLBACK;
