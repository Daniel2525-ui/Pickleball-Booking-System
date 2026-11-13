-- Walk-ins follow the customer rule: a slot can be booked until its first hour ends (at 8:05 AM, 8-9 AM is still open),
-- and never after. This replaces 20261105034947_walk_in_played_today, which let staff record a game that ended earlier today.
-- Must match bookableUntil (src/lib/utils/bookingTime.ts) and hold_court_booking (20261112135357_book_running_hour).
-- Rollback: supabase/rollback_walk_in_running_hour.sql
BEGIN;

DO $mig$
DECLARE
  f text := 'public.create_walk_in_booking(uuid,text,date,time,time,numeric,uuid,uuid,text,text)';
  d text;
  n text;
BEGIN
  d := pg_get_functiondef(f::regprocedure);
  n := replace(d, $q$  IF (p_booking_date + p_end_time) <= v_now_manila AND public.business_date(p_booking_date, p_start_time) <> public.business_day_of(now()) THEN
    RAISE EXCEPTION 'PAST_SLOT: The requested time slot has already ended' USING ERRCODE = '22000';$q$,
    $q$  -- The running hour stays bookable until it ends (bookableUntil in the app); nothing earlier, not even today
  IF (p_booking_date + p_start_time + interval '1 hour') <= v_now_manila THEN
    RAISE EXCEPTION 'PAST_SLOT: The first hour of this slot has already passed' USING ERRCODE = '22000';$q$);
  IF n = d THEN RAISE EXCEPTION 'walk_in_running_hour: past-slot check not found in %', f; END IF;
  -- A slot can no longer have ended when it is saved, so it is always saved as an upcoming booking
  d := n;
  n := replace(d, $q$      CASE WHEN (p_booking_date + p_end_time) <= v_now_manila THEN 'completed' ELSE 'confirmed' END,
      CASE WHEN (p_booking_date + p_end_time) <= v_now_manila THEN now() ELSE NULL END,$q$,
    $q$      'confirmed',
      NULL,$q$);
  IF n = d THEN RAISE EXCEPTION 'walk_in_running_hour: completed status not found in %', f; END IF;
  EXECUTE n;
END
$mig$;

COMMIT;
