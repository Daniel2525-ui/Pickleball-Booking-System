-- Guest checkout, discount codes and number of players.
--   * profiles.is_guest: a player who paid without an account (a Supabase anonymous user). The checkout route writes
--     their profile; handle_new_user turns it into a normal profile when they confirm an email later.
--   * booking_settings.max_players_per_court and bookings.player_count (one count per checkout, on every row).
--   * discount_codes, applied by hold_court_basket to bookings.total_amount and payments.amount before payment opens.
-- Old callers keep working: hold_court_basket's new arguments have defaults.
-- Rollback: supabase/rollback_guest_checkout_discounts_players.sql
BEGIN;

-- 1. Guests ---------------------------------------------------------------------------------------------------------
ALTER TABLE public.profiles ADD COLUMN is_guest boolean NOT NULL DEFAULT false;

-- Only the service role (checkout route) or the confirmation trigger changes it, never the player themself
CREATE FUNCTION public.keep_guest_flag() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
  IF NEW.is_guest IS DISTINCT FROM OLD.is_guest AND coalesce(auth.role(), '') = 'authenticated' THEN
    NEW.is_guest := OLD.is_guest;
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.keep_guest_flag() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER profiles_keep_guest_flag BEFORE UPDATE OF is_guest ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.keep_guest_flag();

-- Confirming an email on a guest's session makes their profile a normal one (same user id, bookings kept)
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
    ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        is_guest = false,
        full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), public.profiles.full_name),
        phone = COALESCE(NULLIF(EXCLUDED.phone, ''), public.profiles.phone)
    WHERE public.profiles.is_guest;

    RETURN NEW;
END;
$function$;

-- 2. Number of players ----------------------------------------------------------------------------------------------
ALTER TABLE public.booking_settings ADD COLUMN max_players_per_court integer NOT NULL DEFAULT 8
  CHECK (max_players_per_court BETWEEN 1 AND 30);
ALTER TABLE public.bookings ADD COLUMN player_count integer CHECK (player_count > 0);

-- 3. Discount codes -------------------------------------------------------------------------------------------------
CREATE TABLE public.discount_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9-]{3,20}$'),
  kind text NOT NULL CHECK (kind IN ('percent', 'fixed')),
  -- Whole numbers only: percents 1-90, pesos off in whole pesos (QR Ph and the cash drawer never see centavos)
  value numeric(10,2) NOT NULL CHECK (value > 0 AND value = trunc(value) AND (kind = 'fixed' OR value <= 90)),
  active boolean NOT NULL DEFAULT true,
  starts_on date,
  ends_on date CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on),
  max_uses integer CHECK (max_uses IS NULL OR max_uses > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);
ALTER TABLE public.discount_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discount_codes FORCE ROW LEVEL SECURITY;
-- Staff read codes (bookings show the code used); writes go through the owner-only API with the service role
CREATE POLICY discount_codes_admin_read ON public.discount_codes FOR SELECT USING (public.is_admin());
GRANT SELECT ON public.discount_codes TO authenticated;

ALTER TABLE public.bookings
  ADD COLUMN discount_code_id uuid REFERENCES public.discount_codes(id) ON DELETE RESTRICT,
  ADD COLUMN discount_amount numeric(10,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0);
CREATE INDEX bookings_discount_code_id_idx ON public.bookings (discount_code_id) WHERE discount_code_id IS NOT NULL;

-- A use is one checkout that still stands: paid or played, or a hold not yet released. A cancelled or expired hold
-- gives the use back, so there is no counter to drift.
CREATE FUNCTION public.discount_code_uses(p_code_id uuid) RETURNS integer LANGUAGE sql STABLE SET search_path TO '' AS $$
  SELECT count(DISTINCT coalesce(b.basket_id, b.id))::integer
  FROM public.bookings b
  WHERE b.discount_code_id = p_code_id
    AND (b.status IN ('confirmed', 'checked_in', 'in_progress', 'completed', 'no_show')
         OR (b.status = 'pending' AND public.hold_release_after(b.hold_expires_at, b.created_at) > clock_timestamp()));
$$;

-- Why a code can't be used today, or NULL when it can
CREATE FUNCTION public.discount_code_refusal(p_code public.discount_codes) RETURNS text LANGUAGE sql STABLE SET search_path TO '' AS $$
  SELECT CASE
    WHEN NOT p_code.active THEN 'This code is switched off.'
    WHEN p_code.starts_on IS NOT NULL AND p_code.starts_on > timezone('Asia/Manila', now())::date THEN 'This code isn''t active yet.'
    WHEN p_code.ends_on IS NOT NULL AND p_code.ends_on < timezone('Asia/Manila', now())::date THEN 'This code has ended.'
    WHEN p_code.max_uses IS NOT NULL AND public.discount_code_uses(p_code.id) >= p_code.max_uses THEN 'This code has been used up.'
  END;
$$;

-- Each court's amount after the code; NULL when a fixed code is worth more than the courts can give.
-- A percent comes off every court in whole pesos; a fixed amount is taken from the courts in order.
-- Every court keeps at least ₱1: a payment of ₱0 could not be recorded. Must match applyDiscount (discounts.ts).
CREATE FUNCTION public.discounted_amounts(p_kind text, p_value numeric, p_amounts numeric[]) RETURNS numeric[]
LANGUAGE plpgsql IMMUTABLE SET search_path TO '' AS $$
DECLARE
  v_out numeric[] := '{}';
  v_left numeric := p_value;
  v_off numeric;
  a numeric;
BEGIN
  FOREACH a IN ARRAY p_amounts LOOP
    IF p_kind = 'percent' THEN
      v_out := v_out || greatest(1, a - round(a * p_value / 100));
    ELSE
      v_off := least(greatest(0, a - 1), v_left);
      v_left := v_left - v_off;
      v_out := v_out || (a - v_off);
    END IF;
  END LOOP;
  RETURN CASE WHEN v_left > 0 AND p_kind = 'fixed' THEN NULL ELSE v_out END;
END $$;

-- The checkout's Apply button (through a rate-limited route): does the code apply, and how much comes off
CREATE FUNCTION public.check_discount_code(p_code text, p_amounts numeric[]) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_code public.discount_codes;
  v_reason text;
  v_after numeric[];
BEGIN
  SELECT * INTO v_code FROM public.discount_codes WHERE code = upper(trim(p_code));
  IF NOT FOUND THEN RETURN jsonb_build_object('valid', false, 'reason', 'There is no such code.'); END IF;
  v_reason := public.discount_code_refusal(v_code);
  IF v_reason IS NOT NULL THEN RETURN jsonb_build_object('valid', false, 'reason', v_reason); END IF;
  v_after := public.discounted_amounts(v_code.kind, v_code.value, p_amounts);
  IF v_after IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'This code is worth more than this booking. Ask the front desk.');
  END IF;
  RETURN jsonb_build_object('valid', true, 'code', v_code.code, 'kind', v_code.kind, 'value', v_code.value,
    'discount', (SELECT sum(x) FROM unnest(p_amounts) x) - (SELECT sum(x) FROM unnest(v_after) x));
END $$;
REVOKE EXECUTE ON FUNCTION public.check_discount_code(text, numeric[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_discount_code(text, numeric[]) TO service_role;
REVOKE EXECUTE ON FUNCTION public.discount_code_uses(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.discount_code_refusal(public.discount_codes) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.discounted_amounts(text, numeric, numeric[]) FROM PUBLIC, anon;

-- 4. The checkout hold: players and the code ------------------------------------------------------------------------
DROP FUNCTION public.hold_court_basket(date, jsonb, timestamptz);

CREATE FUNCTION public.hold_court_basket(p_booking_date date, p_lines jsonb, p_hold_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_player_count integer DEFAULT NULL, p_discount_code text DEFAULT NULL)
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
  v_max_players integer;
  v_code public.discount_codes;
  v_before numeric[];
  v_after numeric[];
  v_item jsonb;
  i integer;
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
  SELECT min_hours, max_players_per_court INTO v_min_hours, v_max_players FROM public.booking_settings WHERE id;
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

  -- Players: one count for the checkout, at most the per-court limit times its courts (checkPlayerCount in the app).
  -- Optional here so an older app that doesn't send it can still book; the checkout route always sends it.
  IF p_player_count IS NOT NULL AND (p_player_count < 1
      OR p_player_count > v_max_players * (SELECT count(DISTINCT court_id) FROM pg_temp.basket_lines)) THEN
    RAISE EXCEPTION 'INVALID_PLAYER_COUNT: This booking takes 1 to % players', v_max_players * (SELECT count(DISTINCT court_id) FROM pg_temp.basket_lines)
      USING ERRCODE = '22000';
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

  IF p_player_count IS NOT NULL THEN
    UPDATE public.bookings SET player_count = p_player_count WHERE basket_id = v_basket;
  END IF;

  -- The code is checked only once the courts are held (a refused code rolls them back), with one message for every
  -- refusal: a direct call can't tell an unknown code from a real one. The Apply preview (rate limited) gives reasons.
  -- The row lock stops two checkouts both taking a code's last use.
  IF nullif(trim(coalesce(p_discount_code, '')), '') IS NOT NULL THEN
    SELECT * INTO v_code FROM public.discount_codes WHERE code = upper(trim(p_discount_code)) FOR UPDATE;
    IF NOT FOUND OR public.discount_code_refusal(v_code) IS NOT NULL THEN
      RAISE EXCEPTION 'DISCOUNT_INVALID: This code can''t be used for this booking.' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- The code comes off the held prices, so the QR Ph charge equals what the bookings and payments record
  IF v_code.id IS NOT NULL THEN
    SELECT array_agg((x->>'amount')::numeric ORDER BY o) INTO v_before FROM jsonb_array_elements(v_items) WITH ORDINALITY t(x, o);
    v_after := public.discounted_amounts(v_code.kind, v_code.value, v_before);
    IF v_after IS NULL THEN
      RAISE EXCEPTION 'DISCOUNT_INVALID: This code can''t be used for this booking.' USING ERRCODE = 'P0001';
    END IF;
    v_total := 0;
    FOR i IN 1 .. jsonb_array_length(v_items) LOOP
      v_item := v_items -> (i - 1);
      UPDATE public.bookings
      SET total_amount = v_after[i], discount_amount = v_before[i] - v_after[i], discount_code_id = v_code.id
      WHERE id = (v_item->>'booking_id')::uuid;
      UPDATE public.payments SET amount = v_after[i] WHERE id = (v_item->>'payment_id')::uuid;
      v_items := jsonb_set(v_items, ARRAY[(i - 1)::text, 'amount'], to_jsonb(v_after[i]));
      v_total := v_total + v_after[i];
    END LOOP;
  END IF;

  PERFORM set_config('app.hold_basket_id', '', true);
  RETURN jsonb_build_object('basket_id', v_basket, 'hold_expires_at', v_expires, 'total', v_total, 'items', v_items,
    'discount', CASE WHEN v_code.id IS NULL THEN 0 ELSE (SELECT sum(x) FROM unnest(v_before) x) - v_total END);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.hold_court_basket(date, jsonb, timestamptz, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hold_court_basket(date, jsonb, timestamptz, integer, text) TO authenticated, service_role;

-- 5. The admin customer list labels guests (type stays 'registered': a guest is a profile, booked by user id)
CREATE OR REPLACE VIEW public.customer_directory WITH (security_invoker = true) AS
SELECT p.id,
    'registered'::text AS type,
    p.full_name,
    p.email,
    p.phone,
    p.created_at,
    h.bookings_count,
    h.last_visit,
    h.no_shows,
    m.total_spent,
    n.note,
    p.is_guest
   FROM profiles p
     CROSS JOIN LATERAL ( SELECT count(*) FILTER (WHERE b.status = ANY (ARRAY['confirmed'::text, 'checked_in'::text, 'in_progress'::text, 'completed'::text, 'no_show'::text]))::integer AS bookings_count,
            max(b.booking_date) FILTER (WHERE b.status = ANY (ARRAY['checked_in'::text, 'in_progress'::text, 'completed'::text])) AS last_visit,
            count(*) FILTER (WHERE b.status = 'no_show'::text)::integer AS no_shows
           FROM bookings b
          WHERE b.user_id = p.id) h
     CROSS JOIN LATERAL ( SELECT COALESCE(sum(pay.amount) FILTER (WHERE pay.status = 'paid'::text), 0::numeric) AS total_spent
           FROM payments pay
             JOIN bookings b ON b.id = pay.booking_id
          WHERE b.user_id = p.id) m
     LEFT JOIN customer_notes n ON n.person_id = p.id
  WHERE COALESCE(p.role, ''::text) <> 'admin'::text
UNION ALL
 SELECT c.id,
    'walk_in'::text AS type,
    c.full_name,
    c.email,
    c.phone,
    c.created_at,
    h.bookings_count,
    h.last_visit,
    h.no_shows,
    m.total_spent,
    n.note,
    false AS is_guest
   FROM customers c
     CROSS JOIN LATERAL ( SELECT count(*) FILTER (WHERE b.status = ANY (ARRAY['confirmed'::text, 'checked_in'::text, 'in_progress'::text, 'completed'::text, 'no_show'::text]))::integer AS bookings_count,
            max(b.booking_date) FILTER (WHERE b.status = ANY (ARRAY['checked_in'::text, 'in_progress'::text, 'completed'::text])) AS last_visit,
            count(*) FILTER (WHERE b.status = 'no_show'::text)::integer AS no_shows
           FROM bookings b
          WHERE b.customer_id = c.id) h
     CROSS JOIN LATERAL ( SELECT COALESCE(sum(pay.amount) FILTER (WHERE pay.status = 'paid'::text), 0::numeric) AS total_spent
           FROM payments pay
             JOIN bookings b ON b.id = pay.booking_id
          WHERE b.customer_id = c.id) m
     LEFT JOIN customer_notes n ON n.person_id = c.id;

COMMIT;
