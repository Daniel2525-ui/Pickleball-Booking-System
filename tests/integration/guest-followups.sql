-- Self-check for 20261113030000_guest_followups. Local stack only, everything rolled back:
--   docker exec -i supabase_db_localdb psql -U postgres -v ON_ERROR_STOP=1 < tests/integration/guest-followups.sql
BEGIN;

CREATE FUNCTION pg_temp.as_player(p_id uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;

DO $$
DECLARE
  v_c1 uuid := (SELECT id FROM public.courts WHERE status = 'active' ORDER BY name LIMIT 1);
  v_c2 uuid := (SELECT id FROM public.courts WHERE status = 'active' ORDER BY name OFFSET 1 LIMIT 1);
  v_player uuid := (SELECT id FROM public.profiles WHERE role <> 'admin' AND NOT is_guest LIMIT 1);
  v_guest uuid := gen_random_uuid();
  v_guest2 uuid := gen_random_uuid();
  v_day date := timezone('Asia/Manila', now())::date + 1;
  v_code uuid;
  v_a jsonb;
  v_b jsonb;
  v_res jsonb;
  v_rows integer;
BEGIN
  DELETE FROM public.refund_requests; DELETE FROM public.payments; DELETE FROM public.bookings;
  DELETE FROM public.open_play_sessions; DELETE FROM public.peak_rates; DELETE FROM public.venue_closures; DELETE FROM public.court_blocks;
  DELETE FROM public.discount_codes;
  UPDATE public.booking_settings SET min_hours = 1, day_ends_at = '00:00', base_hourly_rate = 200, max_players_per_court = 8;
  UPDATE public.operating_hours SET is_open = true, open_time = '06:00', close_time = '22:00';
  INSERT INTO public.discount_codes (code, kind, value, max_uses) VALUES ('ONCE', 'percent', 10, 1) RETURNING id INTO v_code;
  INSERT INTO auth.users (id, instance_id, aud, role, is_anonymous, created_at, updated_at) VALUES
    (v_guest, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true, now(), now()),
    (v_guest2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true, now(), now());
  INSERT INTO public.profiles (id, role, full_name, phone, email, is_guest) VALUES
    (v_guest, 'customer', 'Gina Guest', '09171234567', 'gina@example.com', true),
    (v_guest2, 'customer', 'Gina G.', '09171234567', 'Gina@Example.com', true);

  -- 1. A lapsed hold no longer holds a code's use: the use is free as soon as the 15-minute hold ends
  PERFORM pg_temp.as_player(v_player);
  v_a := public.hold_court_basket(v_day, jsonb_build_array(jsonb_build_object('court_id', v_c1, 'start_time', '08:00', 'end_time', '09:00')), NULL, 2, 'ONCE');
  ASSERT public.discount_code_uses(v_code) = 1, 'a live hold counts';
  UPDATE public.bookings SET hold_expires_at = clock_timestamp() - interval '1 minute' WHERE user_id = v_player;
  ASSERT public.discount_code_uses(v_code) = 0, 'a lapsed hold (still in its grace period) does not';

  -- 2. Someone else takes the freed use; the first player's late payment is refunded, not over the limit
  PERFORM pg_temp.as_player(v_guest);
  v_b := public.hold_court_basket(v_day, jsonb_build_array(jsonb_build_object('court_id', v_c2, 'start_time', '08:00', 'end_time', '09:00')), NULL, 2, 'ONCE');
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  v_res := public.reconcile_booking_payment((v_a->'items'->0->>'booking_id')::uuid, (v_a->'items'->0->>'payment_id')::uuid,
    'cs_late_a', 'pi_late_a', (v_a->'items'->0->>'amount')::numeric, 'php');
  ASSERT v_res->>'action' = 'REFUND_SCHEDULED' AND v_res->>'reason' = 'DISCOUNT_USED_UP', format('late payment over the limit: %s', v_res);
  ASSERT (SELECT status || '|' || cancel_reason FROM public.bookings WHERE id = (v_a->'items'->0->>'booking_id')::uuid) = 'cancelled|discount_used_up', 'cancelled with its reason';
  ASSERT EXISTS (SELECT 1 FROM public.refund_requests WHERE payment_id = (v_a->'items'->0->>'payment_id')::uuid), 'refund reserved';

  -- 3. The guest pays in time: confirmed, and the code now shows its one use
  v_res := public.reconcile_booking_payment((v_b->'items'->0->>'booking_id')::uuid, (v_b->'items'->0->>'payment_id')::uuid,
    'cs_b', 'pi_b', (v_b->'items'->0->>'amount')::numeric, 'php');
  ASSERT v_res->>'action' = 'CONFIRMED', format('on-time payment: %s', v_res);
  ASSERT public.discount_code_uses(v_code) = 1, 'one use';

  -- 4. A late payment while the code still has room is simply confirmed
  UPDATE public.discount_codes SET max_uses = 5 WHERE id = v_code;
  PERFORM pg_temp.as_player(v_player);
  v_a := public.hold_court_basket(v_day, jsonb_build_array(jsonb_build_object('court_id', v_c1, 'start_time', '10:00', 'end_time', '11:00')), NULL, 2, 'ONCE');
  UPDATE public.bookings SET hold_expires_at = clock_timestamp() - interval '1 minute' WHERE id = (v_a->'items'->0->>'booking_id')::uuid;
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  v_res := public.reconcile_booking_payment((v_a->'items'->0->>'booking_id')::uuid, (v_a->'items'->0->>'payment_id')::uuid,
    'cs_late_ok', 'pi_late_ok', (v_a->'items'->0->>'amount')::numeric, 'php');
  ASSERT v_res->>'action' = 'CONFIRMED', format('late payment with room: %s', v_res);

  -- 5. One guest on two devices (same email, any case) is one row in the customer list, bookings added up
  SELECT count(*) INTO v_rows FROM public.customer_directory WHERE is_guest AND lower(email) = 'gina@example.com';
  ASSERT v_rows = 1, format('guest rows: %s', v_rows);
  ASSERT (SELECT bookings_count FROM public.customer_directory WHERE is_guest AND lower(email) = 'gina@example.com') = 1, 'guest bookings counted';
  ASSERT EXISTS (SELECT 1 FROM public.customer_directory WHERE id = v_player AND NOT is_guest), 'members still listed';

  RAISE NOTICE 'guest-followups: all checks passed';
END $$;

ROLLBACK;
