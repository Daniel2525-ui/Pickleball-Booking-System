-- Self-check for one-time open play sessions (20261113030200). Local stack only, everything rolled back:
--   docker exec -i supabase_db_localdb psql -U postgres -v ON_ERROR_STOP=1 < tests/integration/open-play-one-time-sessions.sql
-- Needs an admin profile, a player profile, and two active courts open 6-10 PM ten days from now.
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
END;
$$;

SELECT (SELECT id FROM public.profiles WHERE role = 'admin' LIMIT 1) AS admin_id,
       (SELECT id FROM public.profiles WHERE role <> 'admin' LIMIT 1) AS player_id,
       (SELECT id FROM public.courts WHERE status = 'active' ORDER BY name LIMIT 1) AS c1,
       (SELECT id FROM public.courts WHERE status = 'active' ORDER BY name OFFSET 1 LIMIT 1) AS c2,
       (now() AT TIME ZONE 'Asia/Manila')::date + 10 AS d \gset

SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', :'admin_id', 'role', 'authenticated')::text, true) \g /dev/null

SELECT public.create_open_play_session(:'d', '18:00', '20:00', ARRAY[:'c1']::uuid[], 8, 150) AS sid \gset
SELECT set_config('x.sid', :'sid', true) \g /dev/null
DO $$ BEGIN
  ASSERT (SELECT schedule_id IS NULL AND status = 'open' FROM public.open_play_sessions WHERE id = current_setting('x.sid')::uuid), 'one-time session is open with no schedule';
  ASSERT (SELECT count(*) FROM public.bookings WHERE open_play_session_id = current_setting('x.sid')::uuid AND court_id IS NOT NULL) = 1, 'one block row per court';
END $$;

-- Same checks as the weekly generator, as errors staff can read
SELECT pg_temp.fails(format('SELECT public.create_open_play_session(%L, ''19:00'', ''21:00'', ARRAY[%L]::uuid[], 8, 150)', :'d', :'c1'), 'COURT_BOOKED');
SELECT pg_temp.fails(format('SELECT public.create_open_play_session(%L, ''21:00'', ''23:00'', ARRAY[%L]::uuid[], 8, 150)', :'d', :'c2'), 'VENUE_CLOSED');
SELECT pg_temp.fails(format('SELECT public.create_open_play_session(%L::date - 20, ''18:00'', ''20:00'', ARRAY[%L]::uuid[], 8, 150)', :'d', :'c2'), 'INVALID_ARGUMENT');
SELECT pg_temp.fails(format('SELECT public.create_open_play_session(%L, ''18:30'', ''20:00'', ARRAY[%L]::uuid[], 8, 150)', :'d', :'c2'), 'INVALID_ARGUMENT');
SELECT pg_temp.fails(format('SELECT public.create_open_play_session(%L, ''18:00'', ''20:00'', ARRAY[]::uuid[], 8, 150)', :'d'), 'INVALID_ARGUMENT');

-- Players cannot add sessions, but see and book this one like a weekly session
SELECT set_config('request.jwt.claims', json_build_object('sub', :'player_id', 'role', 'authenticated')::text, true) \g /dev/null
SELECT pg_temp.fails(format('SELECT public.create_open_play_session(%L, ''18:00'', ''20:00'', ARRAY[%L]::uuid[], 8, 150)', :'d', :'c2'), 'FORBIDDEN');
DO $$ BEGIN
  ASSERT (SELECT spots_left FROM public.get_open_play_sessions((now() AT TIME ZONE 'Asia/Manila')::date + 10, (now() AT TIME ZONE 'Asia/Manila')::date + 10) WHERE id = current_setting('x.sid')::uuid) = 8, 'player sees 8 spots';
  ASSERT (public.hold_open_play_spots(current_setting('x.sid')::uuid, 2, 'stripe') ->> 'amount')::numeric = 300, 'player holds 2 spots';
END $$;

\echo 'open play one-time sessions: all checks passed'
ROLLBACK;
