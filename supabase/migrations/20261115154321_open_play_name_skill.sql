-- Open play: optional session name and skill level shown on the player's session cards.
-- Weekly sessions read them live from their schedule; one-time sessions (no schedule) store their own.

BEGIN;

ALTER TABLE public.open_play_schedules
  ADD COLUMN name text CHECK (char_length(name) <= 60),
  ADD COLUMN skill_level text CHECK (char_length(skill_level) <= 40);
ALTER TABLE public.open_play_sessions
  ADD COLUMN name text CHECK (char_length(name) <= 60),
  ADD COLUMN skill_level text CHECK (char_length(skill_level) <= 40);

-- Same pattern as business_day: patch the saved bodies, fail loudly if a target string moved.
DO $mig$
DECLARE
  d text;
  n text;
  r text[];
BEGIN
  d := pg_get_functiondef('public.save_open_play_schedule(uuid,text,time,time,uuid[],int,numeric)'::regprocedure);
  n := d;
  FOREACH r SLICE 1 IN ARRAY ARRAY[
    ['p_price_per_spot numeric)', 'p_price_per_spot numeric, p_name text DEFAULT NULL, p_skill_level text DEFAULT NULL)'],
    ['(day_of_week, start_time, end_time, court_ids, capacity, price_per_spot)', '(day_of_week, start_time, end_time, court_ids, capacity, price_per_spot, name, skill_level)'],
    ['p_capacity, p_price_per_spot)', $q$p_capacity, p_price_per_spot, nullif(btrim(p_name), ''), nullif(btrim(p_skill_level), ''))$q$],
    ['price_per_spot = p_price_per_spot', $q$price_per_spot = p_price_per_spot, name = nullif(btrim(p_name), ''), skill_level = nullif(btrim(p_skill_level), '')$q$]
  ] LOOP
    IF position(r[1] IN n) = 0 THEN RAISE EXCEPTION 'open_play_name_skill: % not found in save_open_play_schedule', r[1]; END IF;
    n := replace(n, r[1], r[2]);
  END LOOP;
  EXECUTE n;

  d := pg_get_functiondef('public.create_open_play_session(date,time,time,uuid[],int,numeric)'::regprocedure);
  n := d;
  FOREACH r SLICE 1 IN ARRAY ARRAY[
    ['p_price_per_spot numeric)', 'p_price_per_spot numeric, p_name text DEFAULT NULL, p_skill_level text DEFAULT NULL)'],
    ['capacity, price_per_spot, status)', 'capacity, price_per_spot, status, name, skill_level)'],
    [$q$p_price_per_spot, 'open')$q$, $q$p_price_per_spot, 'open', nullif(btrim(p_name), ''), nullif(btrim(p_skill_level), ''))$q$]
  ] LOOP
    IF position(r[1] IN n) = 0 THEN RAISE EXCEPTION 'open_play_name_skill: % not found in create_open_play_session', r[1]; END IF;
    n := replace(n, r[1], r[2]);
  END LOOP;
  EXECUTE n;
END;
$mig$;

-- The patched bodies were created as new overloads; drop the old signatures.
DROP FUNCTION public.save_open_play_schedule(uuid, text, time, time, uuid[], int, numeric);
DROP FUNCTION public.create_open_play_session(date, time, time, uuid[], int, numeric);
REVOKE ALL ON FUNCTION public.save_open_play_schedule(uuid, text, time, time, uuid[], int, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_open_play_schedule(uuid, text, time, time, uuid[], int, numeric, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_open_play_session(date, time, time, uuid[], int, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_open_play_session(date, time, time, uuid[], int, numeric, text, text) TO authenticated;

-- Return type changes, so CREATE OR REPLACE is not enough. Body otherwise as left by 20261112015715_business_day.
DROP FUNCTION public.get_open_play_sessions(date, date);
CREATE FUNCTION public.get_open_play_sessions(p_from date, p_to date)
RETURNS TABLE (id uuid, session_date date, start_time time, end_time time, court_names text[],
               capacity int, spots_left int, price_per_spot numeric, my_spots int, name text, skill_level text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT s.id, s.session_date, s.start_time, s.end_time,
    ARRAY(SELECT c.name FROM public.courts c WHERE c.id = ANY (s.court_ids) ORDER BY c.name),
    s.capacity,
    greatest(s.capacity - public.open_play_spots_taken(s.id), 0),
    s.price_per_spot,
    CASE WHEN auth.uid() IS NULL THEN 0 ELSE public.open_play_player_spots(s.id, auth.uid(), NULL) END,
    coalesce(s.name, sch.name),
    coalesce(s.skill_level, sch.skill_level)
  FROM public.open_play_sessions s
  LEFT JOIN public.open_play_schedules sch ON sch.id = s.schedule_id
  WHERE s.status = 'open'
    AND s.session_date BETWEEN p_from AND p_to
    AND (s.session_date + s.start_time) > timezone('Asia/Manila', now())
    AND NOT EXISTS (SELECT 1 FROM public.venue_closures v WHERE v.closed_on = public.business_date(s.session_date, s.start_time))
  ORDER BY s.session_date, s.start_time;
$$;

REVOKE ALL ON FUNCTION public.get_open_play_sessions(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_open_play_sessions(date, date) TO anon, authenticated;

COMMIT;
