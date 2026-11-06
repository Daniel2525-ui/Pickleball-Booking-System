-- Rollback for *_no_max_booking_hours.sql: restores the maximum-length check (booking_settings.max_hours)
-- in hold_court_booking and create_walk_in_booking.
BEGIN;
DO $mig$
DECLARE
  f text;
  d text;
  n text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.hold_court_booking(uuid,date,time,time,uuid,numeric,timestamptz,uuid)',
    'public.create_walk_in_booking(uuid,text,date,time,time,numeric,uuid,uuid,text,text)'
  ] LOOP
    d := pg_get_functiondef(f::regprocedure);
    n := replace(d, 'v_duration_hours < v_min_hours OR (p_end_time', 'v_duration_hours < v_min_hours OR v_duration_hours > v_max_hours OR (p_end_time');
    n := replace(n,
      $q$'INVALID_DURATION: Bookings must be at least % hour(s) long', v_min_hours$q$,
      $q$'INVALID_DURATION: Booking duration must be between % and % consecutive hours', v_min_hours, v_max_hours$q$);
    n := replace(n, '-- 3. Validate duration (whole hours, at least the minimum; no maximum)', '-- 3. Validate duration (1 to 3 whole hours)');
    IF n = d THEN RAISE EXCEPTION 'rollback_no_max_booking_hours: nothing to restore in %', f; END IF;
    EXECUTE n;
  END LOOP;
END
$mig$;
COMMIT;
