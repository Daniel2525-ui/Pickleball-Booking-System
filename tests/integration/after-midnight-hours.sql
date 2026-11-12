-- Self-check for after-midnight operating hours (20261112015645 and 20261112015715). Local stack only, everything rolled back:
--   docker exec -i supabase_db_localdb psql -U postgres -v ON_ERROR_STOP=1 < tests/integration/after-midnight-hours.sql
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
  v_admin uuid := (SELECT id FROM public.profiles WHERE role = 'admin' LIMIT 1);
  v_c1 uuid := (SELECT id FROM public.courts WHERE status = 'active' ORDER BY name LIMIT 1);
  v_c2 uuid := (SELECT id FROM public.courts WHERE status = 'active' ORDER BY name OFFSET 1 LIMIT 1);
  v_c3 uuid := (SELECT id FROM public.courts WHERE status = 'active' ORDER BY name OFFSET 2 LIMIT 1);
  v_player uuid := (SELECT id FROM public.profiles WHERE role <> 'admin' LIMIT 1);
  -- Next week's Thursday to Sunday, so nothing is in the past
  v_thu date := date_trunc('week', timezone('Asia/Manila', now()))::date + 10;
  v_fri date := v_thu + 1;
  v_sat date := v_thu + 2;
  v_sun date := v_thu + 3;
  v_service text := '{"role":"service_role"}';
  v_staff text := json_build_object('sub', v_admin, 'role', 'authenticated')::text;
  v_hold text := 'SELECT public.hold_court_booking(%L, %L, %L, %L, %L, NULL)';
  v_b uuid;
  v_end time;
BEGIN
  DELETE FROM public.refund_requests; DELETE FROM public.payments; DELETE FROM public.bookings;
  DELETE FROM public.open_play_sessions; DELETE FROM public.open_play_schedules;
  DELETE FROM public.peak_rates; DELETE FROM public.venue_closures;
  UPDATE public.booking_settings SET min_hours = 1;
  UPDATE public.operating_hours SET is_open = true, open_time = '08:00', close_time = '22:00';  -- normal days
  UPDATE public.operating_hours SET close_time = '00:00' WHERE day_of_week = 'Thursday';          -- closes at midnight
  UPDATE public.operating_hours SET open_time = '22:00', close_time = '02:00' WHERE day_of_week = 'Friday';  -- 10 PM-2 AM
  UPDATE public.operating_hours SET is_open = false WHERE day_of_week = 'Sunday';

  -- 1. The shared rule
  ASSERT (SELECT array_agg(start_time || '-' || end_time ORDER BY start_time) FROM public.bookable_windows(v_thu)) = ARRAY['08:00:00-24:00:00'], 'Thursday runs to midnight';
  ASSERT (SELECT array_agg(start_time || '-' || end_time ORDER BY start_time) FROM public.bookable_windows(v_fri)) = ARRAY['22:00:00-24:00:00'], 'Friday: no tail from a midnight close, own hours to 24:00';
  ASSERT (SELECT array_agg(start_time || '-' || end_time ORDER BY start_time) FROM public.bookable_windows(v_sat)) = ARRAY['00:00:00-02:00:00', '08:00:00-22:00:00'], 'Saturday: Friday''s tail plus its own hours';
  ASSERT NOT EXISTS (SELECT 1 FROM public.bookable_windows(v_sun)), 'Sunday is closed and Saturday leaves no tail';
  ASSERT public.within_bookable_hours(v_sat, '01:00', '02:00'), 'last late-night hour';
  ASSERT NOT public.within_bookable_hours(v_sat, '02:00', '03:00'), 'after the late close';
  ASSERT NOT public.within_bookable_hours(v_sat, '01:00', '09:00'), '1 AM never joins 8 AM';

  -- 2. Online holds (service role, as the checkout route calls it)
  PERFORM set_config('request.jwt.claims', v_service, true);
  PERFORM public.hold_court_booking(v_c1, v_fri, '23:00', '24:00', v_admin, NULL);
  SELECT end_time INTO v_end FROM public.bookings WHERE court_id = v_c1 AND booking_date = v_fri;
  ASSERT v_end = '24:00', '11 PM-12 AM is stored ending at 24:00';
  PERFORM public.hold_court_booking(v_c1, v_sat, '00:00', '02:00', v_admin, NULL);   -- touches the slot above, no overlap
  PERFORM pg_temp.fails(format(v_hold, v_c1, v_fri, '23:00', '24:00', v_admin), 'SLOT_UNAVAILABLE');
  PERFORM pg_temp.fails(format(v_hold, v_c2, v_sat, '01:00', '03:00', v_admin), 'OUTSIDE_OPERATING_HOURS');
  PERFORM pg_temp.fails(format(v_hold, v_c2, v_fri, '21:00', '22:00', v_admin), 'OUTSIDE_OPERATING_HOURS');
  PERFORM pg_temp.fails(format(v_hold, v_c2, v_sun, '10:00', '11:00', v_admin), 'VENUE_CLOSED');
  -- a normal day is unchanged
  PERFORM public.hold_court_booking(v_c2, v_sat, '08:00', '09:00', v_admin, NULL);
  PERFORM public.hold_court_booking(v_c2, v_sat, '21:00', '22:00', v_admin, NULL);
  PERFORM pg_temp.fails(format(v_hold, v_c2, v_sat, '07:00', '08:00', v_admin), 'OUTSIDE_OPERATING_HOURS');
  PERFORM pg_temp.fails(format(v_hold, v_c2, v_sat, '22:00', '23:00', v_admin), 'OUTSIDE_OPERATING_HOURS');

  -- 3. Walk-ins and moves (staff)
  PERFORM set_config('request.jwt.claims', v_staff, true);
  PERFORM public.create_walk_in_booking(v_c2, 'Late walk-in', v_sat, '00:00', '01:00', NULL, NULL, v_admin, NULL, NULL);
  PERFORM pg_temp.fails(format('SELECT public.create_walk_in_booking(%L, ''Too late'', %L, ''02:00'', ''03:00'', NULL, NULL, %L, NULL, NULL)', v_c2, v_sat, v_admin), 'OUTSIDE_OPERATING_HOURS');

  UPDATE public.bookings SET status = 'confirmed' WHERE court_id = v_c2 AND booking_date = v_sat AND start_time = '08:00' RETURNING id INTO v_b;
  PERFORM public.move_booking(v_b, v_c2, v_fri, '23:00');
  SELECT end_time INTO v_end FROM public.bookings WHERE id = v_b;
  ASSERT v_end = '24:00', 'a move to 11 PM ends at 24:00, not 00:00';
  PERFORM public.move_booking(v_b, v_c2, v_sat, '01:00');
  PERFORM pg_temp.fails(format('SELECT public.move_booking(%L, %L, %L, ''02:00'')', v_b, v_c2, v_sat), 'OUTSIDE_OPERATING_HOURS');
  PERFORM pg_temp.fails(format('SELECT public.move_booking(%L, %L, %L, ''10:00'')', v_b, v_c2, v_sun), 'VENUE_CLOSED');

  -- 3b. The business day (20261112015715): Saturday 12-2 AM belongs to Friday
  ASSERT (SELECT business_date FROM public.bookings WHERE court_id = v_c1 AND booking_date = v_sat AND start_time = '00:00') = v_fri, 'late-night booking is Friday business';
  ASSERT (SELECT business_date FROM public.bookings WHERE court_id = v_c1 AND booking_date = v_fri AND start_time = '23:00') = v_fri, '11 PM is its own day';
  UPDATE public.booking_settings SET day_ends_at = '00:00';
  ASSERT (SELECT business_date FROM public.bookings WHERE court_id = v_c1 AND booking_date = v_sat AND start_time = '00:00') = v_sat, 'moving the cutoff refreshes business dates';
  UPDATE public.booking_settings SET day_ends_at = '04:00';
  ASSERT (SELECT business_date FROM public.bookings WHERE court_id = v_c1 AND booking_date = v_sat AND start_time = '00:00') = v_fri, 'and back';

  -- a Friday peak rate covers Friday's late-night hours, not Friday's own early morning
  UPDATE public.booking_settings SET base_hourly_rate = 200;
  INSERT INTO public.peak_rates (label, days, start_time, end_time, hourly_rate) VALUES ('Late', ARRAY['Friday'], '00:00', '02:00', 500);
  ASSERT public.quote_court_price(v_sat, '00:00', '02:00') = 1000, 'Saturday 12-2 AM is priced as Friday';
  ASSERT public.quote_court_price(v_fri, '00:00', '02:00') = 400, 'Friday 12-2 AM is Thursday business';
  ASSERT public.quote_court_price(v_fri, '23:00', '24:00') = 200, 'ending at 24:00 prices one hour';
  DELETE FROM public.peak_rates;

  -- a closed Saturday keeps Friday's late night; a closed Friday takes it away (customers only)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_player, 'role', 'authenticated')::text, true);
  INSERT INTO public.venue_closures (closed_on) VALUES (v_sat);
  PERFORM pg_temp.fails(format(v_hold, v_c3, v_sat, '08:00', '09:00', v_player), 'VENUE_CLOSED');
  PERFORM public.hold_court_booking(v_c3, v_sat, '00:00', '01:00', v_player, NULL);
  DELETE FROM public.payments WHERE booking_id IN (SELECT id FROM public.bookings WHERE user_id = v_player);
  DELETE FROM public.bookings WHERE user_id = v_player;
  UPDATE public.venue_closures SET closed_on = v_fri;
  PERFORM pg_temp.fails(format(v_hold, v_c3, v_sat, '01:00', '02:00', v_player), 'VENUE_CLOSED');
  PERFORM public.hold_court_booking(v_c3, v_sat, '08:00', '09:00', v_player, NULL);
  DELETE FROM public.venue_closures;

  -- the report still runs, on a week with a 26-hour Friday
  PERFORM set_config('request.jwt.claims', v_staff, true);
  PERFORM public.get_venue_report(v_thu - 14, v_sun);

  -- 4. Open play generator: a late-night schedule opens, one past closing is flagged
  DELETE FROM public.payments; DELETE FROM public.bookings;
  INSERT INTO public.open_play_schedules (day_of_week, start_time, end_time, court_ids, capacity, price_per_spot)
  VALUES ('Saturday', '00:00', '02:00', ARRAY[v_c1], 8, 100), ('Saturday', '02:00', '04:00', ARRAY[v_c2], 8, 100),
         ('Saturday', '09:00', '11:00', ARRAY[v_c2], 8, 100);
  PERFORM public.generate_open_play_sessions(14);
  ASSERT (SELECT status FROM public.open_play_sessions WHERE session_date = v_sat AND start_time = '00:00') = 'open', 'late-night open play opens';
  ASSERT (SELECT status FROM public.open_play_sessions WHERE session_date = v_sat AND start_time = '09:00') = 'open', 'daytime open play opens';
  ASSERT (SELECT flag_reason FROM public.open_play_sessions WHERE session_date = v_sat AND start_time = '02:00') = 'Venue closed', 'open play past closing is flagged';

  RAISE NOTICE 'after-midnight-hours: all checks passed';
END $$;

ROLLBACK;
