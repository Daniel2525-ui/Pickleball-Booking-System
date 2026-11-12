-- Self-check for guest checkout, discount codes and number of players (20261113020000_guest_checkout_discounts_players).
-- Local stack only, everything rolled back:
--   docker exec -i supabase_db_localdb psql -U postgres -v ON_ERROR_STOP=1 < tests/integration/guest-discounts-players.sql
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

-- Acts as one signed-in player for what follows (in this transaction)
CREATE FUNCTION pg_temp.as_player(p_id uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;

CREATE FUNCTION pg_temp.clear(p_user uuid) RETURNS void LANGUAGE sql AS $$
  DELETE FROM public.payments WHERE booking_id IN (SELECT id FROM public.bookings WHERE user_id = p_user);
  DELETE FROM public.bookings WHERE user_id = p_user;
$$;

DO $$
DECLARE
  v_c1 uuid := (SELECT id FROM public.courts WHERE status = 'active' ORDER BY name LIMIT 1);
  v_c2 uuid := (SELECT id FROM public.courts WHERE status = 'active' ORDER BY name OFFSET 1 LIMIT 1);
  v_player uuid := (SELECT id FROM public.profiles WHERE role <> 'admin' AND NOT is_guest LIMIT 1);
  v_guest uuid := gen_random_uuid();
  v_day date := timezone('Asia/Manila', now())::date + 1;
  v_basket text := 'SELECT public.hold_court_basket(%L, %L::jsonb, NULL, %s, %L)';
  v_two jsonb;
  v_res jsonb;
BEGIN
  DELETE FROM public.refund_requests; DELETE FROM public.payments; DELETE FROM public.bookings;
  DELETE FROM public.open_play_sessions; DELETE FROM public.peak_rates; DELETE FROM public.venue_closures; DELETE FROM public.court_blocks;
  DELETE FROM public.discount_codes;
  UPDATE public.booking_settings SET min_hours = 1, day_ends_at = '00:00', base_hourly_rate = 200, max_players_per_court = 4;
  UPDATE public.operating_hours SET is_open = true, open_time = '06:00', close_time = '22:00';
  INSERT INTO public.discount_codes (code, kind, value, active, starts_on, ends_on, max_uses) VALUES
    ('PCT10', 'percent', 10, true, NULL, NULL, NULL),
    ('FIX250', 'fixed', 250, true, NULL, NULL, NULL),
    ('BIG', 'fixed', 1000, true, NULL, NULL, NULL),
    ('OFF', 'percent', 10, false, NULL, NULL, NULL),
    ('LATER', 'percent', 10, true, v_day + 5, NULL, NULL),
    ('OLD', 'percent', 10, true, NULL, v_day - 2, NULL),
    ('ONCE', 'percent', 10, true, NULL, NULL, 1);

  -- A guest: an anonymous auth user, given a profile the way the checkout route does
  INSERT INTO auth.users (id, instance_id, aud, role, is_anonymous, created_at, updated_at)
  VALUES (v_guest, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true, now() - interval '8 days', now());
  INSERT INTO public.profiles (id, role, full_name, phone, email, is_guest) VALUES (v_guest, 'customer', 'Gina Guest', '09171234567', 'gina@example.com', true);

  v_two := jsonb_build_array(
    jsonb_build_object('court_id', v_c1, 'start_time', '08:00', 'end_time', '10:00'),
    jsonb_build_object('court_id', v_c2, 'start_time', '08:00', 'end_time', '10:00'));

  -- 1. Percent code: 10% off each court, written to bookings and payments; players stored on every row
  PERFORM pg_temp.as_player(v_player);
  v_res := public.hold_court_basket(v_day, v_two, NULL, 3, ' pct10 ');
  ASSERT (v_res->>'total')::numeric = 720, format('total %s', v_res->>'total');
  ASSERT (SELECT array_agg(i->>'amount' ORDER BY i->>'court_id') FROM jsonb_array_elements(v_res->'items') i) = ARRAY['360.00', '360.00']
      OR (SELECT bool_and((i->>'amount')::numeric = 360) FROM jsonb_array_elements(v_res->'items') i), 'items discounted';
  ASSERT (SELECT bool_and(b.total_amount = 360 AND b.discount_amount = 40 AND b.player_count = 3 AND b.discount_code_id IS NOT NULL AND p.amount = 360)
          FROM public.bookings b JOIN public.payments p ON p.booking_id = b.id WHERE b.user_id = v_player), 'rows discounted';
  PERFORM pg_temp.clear(v_player);

  -- 2. Fixed code spills from the first court into the next, each keeping ₱1
  v_res := public.hold_court_basket(v_day, jsonb_build_array(
    jsonb_build_object('court_id', v_c1, 'start_time', '08:00', 'end_time', '09:00'),
    jsonb_build_object('court_id', v_c2, 'start_time', '08:00', 'end_time', '10:00')), NULL, 2, 'FIX250');
  ASSERT (v_res->>'total')::numeric = 350, format('fixed total %s', v_res->>'total');
  ASSERT (SELECT sum(discount_amount) = 250 AND min(total_amount) >= 1 AND bool_and(p.amount = b.total_amount) FROM public.bookings b JOIN public.payments p ON p.booking_id = b.id WHERE b.user_id = v_player), 'fixed split: ₱250 off in all, each court keeps ₱1';
  PERFORM pg_temp.clear(v_player);

  -- 3. Refusals: unknown, switched off, not started, ended, worth more than the booking
  PERFORM pg_temp.fails(format(v_basket, v_day, v_two, 2, 'NOPE'), 'DISCOUNT_INVALID');
  PERFORM pg_temp.fails(format(v_basket, v_day, v_two, 2, 'OFF'), 'DISCOUNT_INVALID');
  PERFORM pg_temp.fails(format(v_basket, v_day, v_two, 2, 'LATER'), 'DISCOUNT_INVALID');
  PERFORM pg_temp.fails(format(v_basket, v_day, v_two, 2, 'OLD'), 'DISCOUNT_INVALID');
  PERFORM pg_temp.fails(format(v_basket, v_day, v_two, 2, 'BIG'), 'DISCOUNT_INVALID');
  ASSERT NOT EXISTS (SELECT 1 FROM public.bookings), 'a refused code holds nothing';

  -- 4. Players: at least 1, at most the per-court limit times the courts
  PERFORM pg_temp.fails(format(v_basket, v_day, v_two, 0, NULL), 'INVALID_PLAYER_COUNT');
  PERFORM pg_temp.fails(format(v_basket, v_day, v_two, 9, NULL), 'INVALID_PLAYER_COUNT');
  v_res := public.hold_court_basket(v_day, v_two, NULL, 8, NULL);
  ASSERT (v_res->>'total')::numeric = 800, 'no code, full price';
  PERFORM pg_temp.clear(v_player);
  PERFORM pg_temp.fails(format(v_basket, v_day, jsonb_build_array(jsonb_build_object('court_id', v_c1, 'start_time', '08:00', 'end_time', '09:00')), 5, NULL), 'INVALID_PLAYER_COUNT');

  -- 5. A code's last use goes to one checkout; a cancelled checkout gives it back
  v_res := public.hold_court_basket(v_day, jsonb_build_array(jsonb_build_object('court_id', v_c1, 'start_time', '08:00', 'end_time', '09:00')), NULL, 1, 'ONCE');
  ASSERT (public.check_discount_code('ONCE', ARRAY[200])->>'valid')::boolean = false, 'preview sees it used up';
  PERFORM pg_temp.as_player(v_guest);
  PERFORM pg_temp.fails(format(v_basket, v_day, jsonb_build_array(jsonb_build_object('court_id', v_c2, 'start_time', '08:00', 'end_time', '09:00')), 1, 'ONCE'), 'DISCOUNT_INVALID');
  UPDATE public.bookings SET status = 'cancelled', cancel_reason = 'customer' WHERE user_id = v_player;
  v_res := public.hold_court_basket(v_day, jsonb_build_array(jsonb_build_object('court_id', v_c2, 'start_time', '08:00', 'end_time', '09:00')), NULL, 1, 'ONCE');
  ASSERT (v_res->>'total')::numeric = 180, 'the given-back use works for the guest';

  -- 5b. A direct call can't probe codes: a taken court is refused first, and every code refusal reads the same
  PERFORM pg_temp.as_player(v_player);  -- the guest's hold above takes COURT 2 at 8 AM
  PERFORM pg_temp.fails(format(v_basket, v_day, jsonb_build_array(jsonb_build_object('court_id', v_c2, 'start_time', '08:00', 'end_time', '09:00')), 1, 'NOPE'), 'SLOT_UNAVAILABLE');
  BEGIN
    PERFORM public.hold_court_basket(v_day, jsonb_build_array(jsonb_build_object('court_id', v_c1, 'start_time', '15:00', 'end_time', '16:00')), NULL, 1, 'OFF');
    RAISE EXCEPTION 'a switched-off code was accepted';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM = 'DISCOUNT_INVALID: This code can''t be used for this booking.', format('same message for every refusal: %s', SQLERRM);
  END;
  PERFORM pg_temp.as_player(v_guest);
  -- Codes take whole pesos off
  PERFORM pg_temp.fails($q$INSERT INTO public.discount_codes (code, kind, value) VALUES ('CENTS', 'fixed', 10.5)$q$, 'new row for relation "discount_codes" violates check constraint');

  -- 6. Preview
  ASSERT public.check_discount_code('pct10', ARRAY[400]) @> '{"valid": true, "discount": 40}', format('preview %s', public.check_discount_code('pct10', ARRAY[400]));
  ASSERT public.check_discount_code('OFF', ARRAY[400])->>'valid' = 'false', 'preview refuses switched off';
  ASSERT public.check_discount_code('BIG', ARRAY[400])->>'valid' = 'false', 'preview refuses worth more than booking';

  -- The admin customer list labels them
  ASSERT (SELECT is_guest FROM public.customer_directory WHERE id = v_guest), 'customer list shows the guest';

  -- 7. A guest can't clear their own guest flag
  UPDATE public.profiles SET is_guest = false WHERE id = v_guest;
  ASSERT (SELECT is_guest FROM public.profiles WHERE id = v_guest), 'guest flag kept';

  -- 8. The 7-day cleanup keeps a guest who has a profile (and their bookings)
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM public.delete_stale_unconfirmed_users();
  ASSERT EXISTS (SELECT 1 FROM auth.users WHERE id = v_guest), 'guest kept by cleanup';

  -- 9. Creating an account from the guest session: the profile stops being a guest's
  UPDATE auth.users SET email = 'gina@example.com', email_confirmed_at = now(), is_anonymous = false WHERE id = v_guest;
  ASSERT (SELECT NOT is_guest AND email = 'gina@example.com' AND full_name = 'Gina Guest' FROM public.profiles WHERE id = v_guest), 'guest converted';
  ASSERT EXISTS (SELECT 1 FROM public.bookings WHERE user_id = v_guest), 'bookings kept';

  RAISE NOTICE 'guest-discounts-players: all checks passed';
END $$;

ROLLBACK;
