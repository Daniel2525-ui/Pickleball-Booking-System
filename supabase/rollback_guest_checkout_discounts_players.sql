-- Rollback for 20261113020000_guest_checkout_discounts_players. Revert the app first: the new checkout sends
-- player_count and discount_code, which the old hold_court_basket does not take.
-- Guest profiles (is_guest) stay as ordinary customer profiles; their bookings are kept. Discounts already applied
-- stay in bookings.total_amount and payments.amount (the codes themselves are dropped).
BEGIN;

DROP FUNCTION public.hold_court_basket(date, jsonb, timestamptz, integer, text);

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
  v_min_hours integer;
BEGIN
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_lines) = 0
     OR jsonb_array_length(p_lines) > 24 * (SELECT count(*) FROM public.courts) THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: p_lines must list between 1 and 24 times per court' USING ERRCODE = '22000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_lines) e
    WHERE jsonb_typeof(e) != 'object' OR e->>'court_id' IS NULL OR e->>'start_time' IS NULL OR e->>'end_time' IS NULL
       OR (e ? 'booking_date' AND jsonb_typeof(e->'booking_date') != 'string')
  ) THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Each line needs court_id, start_time and end_time' USING ERRCODE = '22000';
  END IF;

  -- A line's date defaults to the basket's; the business day's after-midnight hours are on the next date
  CREATE TEMP TABLE IF NOT EXISTS pg_temp.basket_lines (ord bigint, court_id uuid, line_date date, start_time time, end_time time) ON COMMIT DROP;
  TRUNCATE pg_temp.basket_lines;
  INSERT INTO pg_temp.basket_lines
  SELECT e.ord, (e.v->>'court_id')::uuid, coalesce((e.v->>'booking_date')::date, p_booking_date), (e.v->>'start_time')::time, (e.v->>'end_time')::time
  FROM jsonb_array_elements(p_lines) WITH ORDINALITY e(v, ord);

  IF EXISTS (SELECT 1 FROM pg_temp.basket_lines l WHERE public.business_date(l.line_date, l.start_time) IS DISTINCT FROM p_booking_date) THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: A time is not on this booking day' USING ERRCODE = '22000';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_temp.basket_lines a
    JOIN pg_temp.basket_lines b
      ON a.ord < b.ord AND a.court_id = b.court_id AND a.line_date = b.line_date
     AND a.start_time < b.end_time AND b.start_time < a.end_time
  ) THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Two times on the same court overlap' USING ERRCODE = '22000';
  END IF;

  -- The minimum counts a run across midnight as one booking (hold_court_booking skips it for basket lines)
  SELECT min_hours INTO v_min_hours FROM public.booking_settings WHERE id;
  IF v_min_hours IS NULL THEN
    RAISE EXCEPTION 'PRICING_NOT_CONFIGURED: booking_settings row is missing' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_temp.basket_lines a
    WHERE extract(epoch FROM a.end_time - a.start_time) / 3600 + coalesce((
      SELECT extract(epoch FROM b.end_time - b.start_time) / 3600 FROM pg_temp.basket_lines b
      WHERE b.court_id = a.court_id
        AND ((a.end_time = '24:00' AND b.start_time = '00:00' AND b.line_date = a.line_date + 1)
          OR (a.start_time = '00:00' AND b.end_time = '24:00' AND b.line_date = a.line_date - 1))
      LIMIT 1), 0) < v_min_hours
  ) THEN
    RAISE EXCEPTION 'INVALID_DURATION: Bookings must be at least % hour(s) long', v_min_hours USING ERRCODE = '22000';
  END IF;

  -- Lets hold_court_booking accept v_basket for this transaction only (see its p_basket_id guard)
  PERFORM set_config('app.hold_basket_id', v_basket::text, true);

  -- Court, date, then start order gives every basket the same lock order, so overlapping baskets cannot deadlock
  FOR v_line IN
    SELECT l.court_id, l.line_date, l.start_time, l.end_time, c.name AS court_name
    FROM pg_temp.basket_lines l
    LEFT JOIN public.courts c ON c.id = l.court_id
    ORDER BY 1, 2, 3
  LOOP
    BEGIN
      v_hold := public.hold_court_booking(
        p_court_id => v_line.court_id, p_booking_date => v_line.line_date,
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
      'booking_date', v_line.line_date,
      'start_time', v_line.start_time,
      'end_time', v_line.end_time,
      'amount', v_hold->'amount'
    ));
  END LOOP;

  PERFORM set_config('app.hold_basket_id', '', true);
  RETURN jsonb_build_object('basket_id', v_basket, 'hold_expires_at', v_expires, 'total', v_total, 'items', v_items);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.hold_court_basket(date, jsonb, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hold_court_basket(date, jsonb, timestamptz) TO authenticated, service_role;

DROP FUNCTION public.check_discount_code(text, numeric[]);
DROP FUNCTION public.discounted_amounts(text, numeric, numeric[]);
DROP FUNCTION public.discount_code_refusal(public.discount_codes);
DROP FUNCTION public.discount_code_uses(uuid);
ALTER TABLE public.bookings DROP COLUMN discount_code_id, DROP COLUMN discount_amount, DROP COLUMN player_count;
DROP TABLE public.discount_codes;
ALTER TABLE public.booking_settings DROP COLUMN max_players_per_court;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
    INSERT INTO public.profiles (
        id,
        email,
        full_name,
        phone,
        role
    )
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(
            NULLIF(NEW.raw_user_meta_data ->> 'full_name', ''),
            NULLIF(NEW.raw_user_meta_data ->> 'name', '')
        ),
        COALESCE(NEW.raw_user_meta_data ->> 'phone', ''),
        'customer'
    )
    ON CONFLICT (id) DO NOTHING;

    RETURN NEW;
END;
$function$;

DROP TRIGGER profiles_keep_guest_flag ON public.profiles;
DROP FUNCTION public.keep_guest_flag();
ALTER TABLE public.profiles DROP COLUMN is_guest;

COMMIT;
