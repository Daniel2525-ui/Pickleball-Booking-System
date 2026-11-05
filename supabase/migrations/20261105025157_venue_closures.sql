-- Venue closures: whole days the venue is shut (holiday, typhoon, private event), on top of the weekly hours.
-- Customers cannot book a closed date; staff still can (walk-ins, private events). Bookings already on the
-- date are left alone: staff contact or cancel those players through the existing flows.

BEGIN;

CREATE TABLE IF NOT EXISTS public.venue_closures (
  closed_on date PRIMARY KEY,
  reason text CHECK (char_length(reason) <= 120),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.venue_closures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_closures FORCE ROW LEVEL SECURITY;

-- Same rules as operating_hours: everyone reads (the booking page shows closed dates), only staff write
DROP POLICY IF EXISTS venue_closures_select_policy ON public.venue_closures;
CREATE POLICY venue_closures_select_policy ON public.venue_closures
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS venue_closures_admin_policy ON public.venue_closures;
CREATE POLICY venue_closures_admin_policy ON public.venue_closures
  FOR ALL
  USING (
    coalesce(auth.role(), '') = 'service_role'
    OR (current_user = 'postgres' AND auth.role() IS NULL)
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- One check for every way a booking is created (online holds, GCash, open play spots, walk-ins).
-- auth.role() is the caller's JWT role even inside SECURITY DEFINER functions; NULL only on a direct DB session.
CREATE OR REPLACE FUNCTION public.block_closed_date_booking()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.venue_closures WHERE closed_on = NEW.booking_date)
     AND NOT (auth.role() IS NULL OR auth.role() = 'service_role' OR public.is_admin()) THEN
    RAISE EXCEPTION 'VENUE_CLOSED' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bookings_block_closed_date ON public.bookings;
CREATE TRIGGER bookings_block_closed_date
  BEFORE INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.block_closed_date_booking();

-- Open play sessions on a closed date are no longer offered to players (body otherwise unchanged from 20261102031219)
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
    AND NOT EXISTS (SELECT 1 FROM public.venue_closures v WHERE v.closed_on = s.session_date)
  ORDER BY s.session_date, s.start_time;
$$;

COMMIT;
