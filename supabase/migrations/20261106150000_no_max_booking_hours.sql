-- Bookings no longer have a maximum length: a player can book as many consecutive hours as are free.
-- The minimum (booking_settings.min_hours) still applies. booking_settings.max_hours is kept but no longer read
-- as a limit. Edits the live hold_court_booking and create_walk_in_booking in place so nothing else changes;
-- each replacement must match or the migration fails and changes nothing.
-- Rollback: supabase/rollback_no_max_booking_hours.sql
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
    n := replace(d, 'v_duration_hours < v_min_hours OR v_duration_hours > v_max_hours OR', 'v_duration_hours < v_min_hours OR');
    IF n = d THEN RAISE EXCEPTION 'no_max_booking_hours: duration check not found in %', f; END IF;
    d := n;
    n := replace(d,
      $q$'INVALID_DURATION: Booking duration must be between % and % consecutive hours', v_min_hours, v_max_hours$q$,
      $q$'INVALID_DURATION: Bookings must be at least % hour(s) long', v_min_hours$q$);
    IF n = d THEN RAISE EXCEPTION 'no_max_booking_hours: duration message not found in %', f; END IF;
    n := replace(n, '-- 3. Validate duration (1 to 3 whole hours)', '-- 3. Validate duration (whole hours, at least the minimum; no maximum)');
    EXECUTE n;
  END LOOP;
END
$mig$;
