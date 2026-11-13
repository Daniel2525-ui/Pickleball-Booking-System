-- Rollback for 20261112135357_book_running_hour: a slot closes again the moment it starts.
-- Revert the app (bookableUntil, the grid's "passed" rule) first, or the grid offers hours checkout refuses.
BEGIN;

DO $mig$
DECLARE
  f text;
  d text;
  n text;
BEGIN
  f := 'public.hold_court_booking(uuid,date,time,time,uuid,numeric,timestamptz,uuid)';
  d := pg_get_functiondef(f::regprocedure);
  n := replace(d, $q$  -- The running hour stays bookable until it ends (bookableUntil in the app)
  IF (p_booking_date + p_start_time + interval '1 hour') <= v_now_manila THEN$q$,
    $q$  IF (p_booking_date + p_start_time) <= v_now_manila THEN$q$);
  IF n = d THEN RAISE EXCEPTION 'rollback_book_running_hour: check not found in %', f; END IF;
  EXECUTE n;

  f := 'public.reconcile_booking_payment(uuid,uuid,text,text,numeric,text)';
  d := pg_get_functiondef(f::regprocedure);
  n := replace(d, $q$  -- Paid before its first hour ended: the booking stands (an 8 AM court paid at 8:10 is still played)
  v_is_past := ((v_booking.booking_date + v_booking.start_time + interval '1 hour') AT TIME ZONE 'Asia/Manila') <= v_now;$q$,
    $q$  v_is_past := ((v_booking.booking_date + v_booking.start_time) AT TIME ZONE 'Asia/Manila') <= v_now;$q$);
  IF n = d THEN RAISE EXCEPTION 'rollback_book_running_hour: check not found in %', f; END IF;
  EXECUTE n;
END
$mig$;

COMMIT;
