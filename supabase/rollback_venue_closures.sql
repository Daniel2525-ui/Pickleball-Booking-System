-- Rollback for 20261105025157_venue_closures.sql

BEGIN;

DROP TRIGGER IF EXISTS bookings_block_closed_date ON public.bookings;
DROP FUNCTION IF EXISTS public.block_closed_date_booking();

-- get_open_play_sessions as defined in 20261102031219_open_play_read.sql
CREATE OR REPLACE FUNCTION public.get_open_play_sessions(p_from date, p_to date)
RETURNS TABLE (id uuid, session_date date, start_time time, end_time time, court_names text[],
               capacity int, spots_left int, price_per_spot numeric, my_spots int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT s.id, s.session_date, s.start_time, s.end_time,
    ARRAY(SELECT c.name FROM public.courts c WHERE c.id = ANY (s.court_ids) ORDER BY c.name),
    s.capacity,
    greatest(s.capacity - public.open_play_spots_taken(s.id), 0),
    s.price_per_spot,
    CASE WHEN auth.uid() IS NULL THEN 0 ELSE public.open_play_player_spots(s.id, auth.uid(), NULL) END
  FROM public.open_play_sessions s
  WHERE s.status = 'open'
    AND s.session_date BETWEEN p_from AND p_to
    AND (s.session_date + s.start_time) > timezone('Asia/Manila', now())
  ORDER BY s.session_date, s.start_time;
$$;

DROP TABLE IF EXISTS public.venue_closures;

COMMIT;
