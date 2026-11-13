-- Rollback for walk_in_running_hour: walk-ins may again record a slot that ended earlier today (saved as completed).
-- Revert the app first so the picker offers those hours again.
BEGIN;

DO $mig$
DECLARE
  f text := 'public.create_walk_in_booking(uuid,text,date,time,time,numeric,uuid,uuid,text,text)';
  d text;
  n text;
BEGIN
  d := pg_get_functiondef(f::regprocedure);
  n := replace(d, $q$  -- The running hour stays bookable until it ends (bookableUntil in the app); nothing earlier, not even today
  IF (p_booking_date + p_start_time + interval '1 hour') <= v_now_manila THEN
    RAISE EXCEPTION 'PAST_SLOT: The first hour of this slot has already passed' USING ERRCODE = '22000';$q$,
    $q$  IF (p_booking_date + p_end_time) <= v_now_manila AND public.business_date(p_booking_date, p_start_time) <> public.business_day_of(now()) THEN
    RAISE EXCEPTION 'PAST_SLOT: The requested time slot has already ended' USING ERRCODE = '22000';$q$);
  IF n = d THEN RAISE EXCEPTION 'rollback walk_in_running_hour: check not found'; END IF;
  d := n;
  n := replace(d, $q$      'confirmed',
      NULL,$q$,
    $q$      CASE WHEN (p_booking_date + p_end_time) <= v_now_manila THEN 'completed' ELSE 'confirmed' END,
      CASE WHEN (p_booking_date + p_end_time) <= v_now_manila THEN now() ELSE NULL END,$q$);
  IF n = d THEN RAISE EXCEPTION 'rollback walk_in_running_hour: status not found'; END IF;
  EXECUTE n;
END
$mig$;

COMMIT;
