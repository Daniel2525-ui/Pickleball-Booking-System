-- Open play: public reads. Sessions come through an RPC (the tables are admin-only); the court grid
-- gets an open_play flag on block rows and no longer sees court-less spot rows.

BEGIN;

CREATE FUNCTION public.get_open_play_sessions(p_from date, p_to date)
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

REVOKE ALL ON FUNCTION public.get_open_play_sessions(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_open_play_sessions(date, date) TO anon, authenticated;

-- Return type changes, so CREATE OR REPLACE is not enough.
DROP FUNCTION public.get_public_slot_availability(date);
CREATE FUNCTION public.get_public_slot_availability(p_booking_date date)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  court_id uuid,
  start_time time,
  end_time time,
  status text,
  hold_expires_at timestamptz,
  open_play boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT 
    CASE WHEN b.user_id = auth.uid() THEN b.id ELSE NULL END AS id,
    CASE WHEN b.user_id = auth.uid() THEN b.user_id ELSE NULL END AS user_id,
    b.court_id,
    b.start_time,
    b.end_time,
    b.status,
    CASE WHEN b.user_id = auth.uid() THEN b.hold_expires_at ELSE NULL END AS hold_expires_at,
    b.open_play_session_id IS NOT NULL AS open_play
  FROM public.bookings b
  WHERE b.booking_date = p_booking_date
    AND b.court_id IS NOT NULL
    AND (
      b.status IN ('confirmed', 'completed', 'checked_in', 'in_progress')
      OR (
        b.status = 'pending' 
        AND public.hold_release_after(b.hold_expires_at, b.created_at) > statement_timestamp()
      )
    );
$$;

ALTER FUNCTION public.get_public_slot_availability(date) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_public_slot_availability(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_slot_availability(date) TO anon, authenticated, service_role;

COMMIT;
