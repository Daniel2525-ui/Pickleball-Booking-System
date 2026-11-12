-- Rollback for 20261112140000_late_night_basket: restores hold_court_basket and hold_court_booking exactly as
-- production had them on 2026-11-12 (20261106135055 / 20261106135314 plus the 20261112015645 hours patch).
-- Apply only after the app no longer sends per-line dates (revert the late-night checkout first).
BEGIN;

CREATE OR REPLACE FUNCTION public.hold_court_basket(p_booking_date date, p_lines jsonb, p_hold_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_basket uuid := gen_random_uuid();
  v_line record;
  v_hold jsonb;
  v_items jsonb := '[]'::jsonb;
  v_total numeric := 0;
  v_expires timestamptz;
BEGIN
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_lines) = 0
     OR jsonb_array_length(p_lines) > 24 * (SELECT count(*) FROM public.courts) THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: p_lines must list between 1 and 24 times per court' USING ERRCODE = '22000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_lines) e
    WHERE jsonb_typeof(e) != 'object' OR e->>'court_id' IS NULL OR e->>'start_time' IS NULL OR e->>'end_time' IS NULL
  ) THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Each line needs court_id, start_time and end_time' USING ERRCODE = '22000';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_lines) WITH ORDINALITY a(e, i)
    JOIN jsonb_array_elements(p_lines) WITH ORDINALITY b(e, j)
      ON a.i < b.j
     AND (a.e->>'court_id')::uuid = (b.e->>'court_id')::uuid
     AND (a.e->>'start_time')::time < (b.e->>'end_time')::time
     AND (b.e->>'start_time')::time < (a.e->>'end_time')::time
  ) THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Two times on the same court overlap' USING ERRCODE = '22000';
  END IF;

  -- Lets hold_court_booking accept v_basket for this transaction only (see its p_basket_id guard)
  PERFORM set_config('app.hold_basket_id', v_basket::text, true);

  -- Court then start order gives every basket the same lock order, so overlapping baskets cannot deadlock
  FOR v_line IN
    SELECT (e->>'court_id')::uuid AS court_id, (e->>'start_time')::time AS start_time, (e->>'end_time')::time AS end_time, c.name AS court_name
    FROM jsonb_array_elements(p_lines) e
    LEFT JOIN public.courts c ON c.id = (e->>'court_id')::uuid
    ORDER BY 1, 2
  LOOP
    BEGIN
      v_hold := public.hold_court_booking(
        p_court_id => v_line.court_id, p_booking_date => p_booking_date,
        p_start_time => v_line.start_time, p_end_time => v_line.end_time,
        p_user_id => auth.uid(), p_amount => NULL,
        p_hold_expires_at => p_hold_expires_at, p_basket_id => v_basket
      );
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM = 'SLOT_UNAVAILABLE' THEN
        RAISE EXCEPTION 'SLOT_UNAVAILABLE: % %–%', v_line.court_name,
          to_char(v_line.start_time, 'HH:MI AM'), to_char(v_line.end_time, 'HH:MI AM') USING ERRCODE = 'P0001';
      END IF;
      RAISE;
    END;

    v_total := v_total + (v_hold->>'amount')::numeric;
    v_expires := least(v_expires, (v_hold->>'hold_expires_at')::timestamptz);
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'booking_id', v_hold->'booking_id',
      'payment_id', v_hold->'payment_id',
      'court_id', v_line.court_id,
      'court_name', v_line.court_name,
      'start_time', v_line.start_time,
      'end_time', v_line.end_time,
      'amount', v_hold->'amount'
    ));
  END LOOP;

  PERFORM set_config('app.hold_basket_id', '', true);
  RETURN jsonb_build_object('basket_id', v_basket, 'hold_expires_at', v_expires, 'total', v_total, 'items', v_items);
END;
$function$;

-- hold_court_booking: only the two changed passages differ from 20261112140000; restore them
DO $mig$
DECLARE
  f constant text := 'public.hold_court_booking(uuid,date,time,time,uuid,numeric,timestamptz,uuid)';
  d text := pg_get_functiondef(f::regprocedure);
  n text;
BEGIN
  n := replace(d, $q$  IF (v_duration_hours < v_min_hours
      -- A basket checks the minimum per run (hold_court_basket), so 11 PM-12 AM and 12-1 AM on one court count as 2 hours
      AND NOT (p_basket_id IS NOT NULL AND current_setting('app.hold_basket_id', true) = p_basket_id::text))
     OR (p_end_time - p_start_time) != (v_duration_hours || ' hours')::interval THEN$q$,
    $q$  IF v_duration_hours < v_min_hours OR (p_end_time - p_start_time) != (v_duration_hours || ' hours')::interval THEN$q$);
  n := replace(n, $q$    -- It may only extend the caller's own basket, on its booking day, with a time that doesn't overlap one already held
    IF p_basket_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.bookings
      WHERE basket_id = p_basket_id
        AND (user_id IS DISTINCT FROM p_user_id
             OR business_date IS DISTINCT FROM public.business_date(p_booking_date, p_start_time)
             OR (court_id = p_court_id AND booking_date = p_booking_date AND start_time < p_end_time AND end_time > p_start_time))
    ) THEN$q$,
    $q$    -- It may only extend the caller's own basket, on its date, with a time that doesn't overlap one already held
    IF p_basket_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.bookings
      WHERE basket_id = p_basket_id
        AND (user_id IS DISTINCT FROM p_user_id OR booking_date != p_booking_date
             OR (court_id = p_court_id AND start_time < p_end_time AND end_time > p_start_time))
    ) THEN$q$);
  IF n = d OR n LIKE '%app.hold_basket_id'', true) = p_basket_id%' OR n LIKE '%business_date IS DISTINCT FROM%' THEN
    RAISE EXCEPTION 'rollback_late_night_basket: changed passages not found in %', f;
  END IF;
  EXECUTE n;
END
$mig$;

COMMIT;
