-- A closed date (venue_closures) is closed for walk-ins too. The bookings trigger lets staff through on purpose
-- (open play court reservations, open play walk-ups), so the walk-in function checks it itself. After-midnight
-- hours belong to the night before, so the business date is checked, as on the booking grid.

BEGIN;

DO $mig$
DECLARE
  d text := pg_get_functiondef('public.create_walk_in_booking(uuid,text,date,time,time,numeric,uuid,uuid,text,text)'::regprocedure);
  anchor text := '  -- 4. Verify operating hours' || chr(10);
BEGIN
  IF position(anchor IN d) = 0 THEN RAISE EXCEPTION 'walk_in_closed_dates: % not found in create_walk_in_booking', anchor; END IF;
  EXECUTE replace(d, anchor, anchor || $chk$  IF EXISTS (SELECT 1 FROM public.venue_closures WHERE closed_on = public.business_date(p_booking_date, p_start_time)) THEN
    RAISE EXCEPTION 'VENUE_CLOSED: The venue is closed on this date' USING ERRCODE = 'P0001';
  END IF;
$chk$);
END;
$mig$;

COMMIT;
