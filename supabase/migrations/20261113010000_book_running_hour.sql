-- An hour stays bookable until it ends: at 8:05 AM the 8-9 AM slot can still be held and paid for.
-- Before, a slot closed the moment it started, and a payment arriving after the start was refunded ("start_passed").
-- Both now use the end of the booking's first hour. Must match bookableUntil (src/lib/utils/bookingTime.ts).
-- Admin walk-ins and moves keep their own rules. Rollback: supabase/rollback_book_running_hour.sql
BEGIN;

DO $mig$
DECLARE
  f text;
  d text;
  n text;
BEGIN
  f := 'public.hold_court_booking(uuid,date,time,time,uuid,numeric,timestamptz,uuid)';
  d := pg_get_functiondef(f::regprocedure);
  n := replace(d, $q$  IF (p_booking_date + p_start_time) <= v_now_manila THEN$q$,
    $q$  -- The running hour stays bookable until it ends (bookableUntil in the app)
  IF (p_booking_date + p_start_time + interval '1 hour') <= v_now_manila THEN$q$);
  IF n = d THEN RAISE EXCEPTION 'book_running_hour: past-slot check not found in %', f; END IF;
  EXECUTE n;

  f := 'public.reconcile_booking_payment(uuid,uuid,text,text,numeric,text)';
  d := pg_get_functiondef(f::regprocedure);
  n := replace(d, $q$  v_is_past := ((v_booking.booking_date + v_booking.start_time) AT TIME ZONE 'Asia/Manila') <= v_now;$q$,
    $q$  -- Paid before its first hour ended: the booking stands (an 8 AM court paid at 8:10 is still played)
  v_is_past := ((v_booking.booking_date + v_booking.start_time + interval '1 hour') AT TIME ZONE 'Asia/Manila') <= v_now;$q$);
  IF n = d THEN RAISE EXCEPTION 'book_running_hour: start-passed check not found in %', f; END IF;
  EXECUTE n;
END
$mig$;

COMMIT;
