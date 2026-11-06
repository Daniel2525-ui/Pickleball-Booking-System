-- A basket may hold several separate times on the same court (e.g. Court 1 8-9 AM and 2-3 PM).
-- Only overlapping times on one court are refused. The old "no more lines than courts" cap becomes
-- a sanity bound of 24 lines per court; the app caps a checkout at Stripe's 100 line items.
-- Rollback: supabase/rollback_basket_separate_times_per_court.sql

CREATE OR REPLACE FUNCTION public.hold_court_basket(p_booking_date date, p_lines jsonb, p_hold_expires_at timestamptz DEFAULT NULL) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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
$$;
REVOKE ALL ON FUNCTION public.hold_court_basket(date, jsonb, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hold_court_basket(date, jsonb, timestamptz) TO authenticated, service_role;
