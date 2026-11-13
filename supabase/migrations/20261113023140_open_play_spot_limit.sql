-- Open play: the most spots one player may hold in a session is a venue setting (was a fixed 4).
-- The functions below are copies of their latest versions with only the 4 replaced by the setting.

BEGIN;

ALTER TABLE public.booking_settings ADD COLUMN max_open_play_spots_per_player integer NOT NULL DEFAULT 4
  CHECK (max_open_play_spots_per_player BETWEEN 1 AND 30);

-- The functions enforce the per-player limit now; the row only needs a positive count
ALTER TABLE public.bookings DROP CONSTRAINT bookings_court_or_open_play;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_court_or_open_play CHECK (
  (court_id IS NOT NULL AND open_play_spots IS NULL)
  OR (court_id IS NULL AND open_play_session_id IS NOT NULL AND open_play_spots >= 1)
);

CREATE OR REPLACE FUNCTION public.hold_open_play_spots(p_session_id uuid, p_spots int, p_payment_method text DEFAULT 'stripe')
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_session record;
  v_name text;
  v_basket uuid := gen_random_uuid();
  v_amount numeric;
  v_booking_id uuid;
  v_payment_id uuid;
  v_expires timestamptz := now() + interval '35 minutes';
  v_limit int := (SELECT max_open_play_spots_per_player FROM public.booking_settings WHERE id);
BEGIN
  IF v_uid IS NULL OR coalesce(auth.role(), '') != 'authenticated' THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required to hold spots' USING ERRCODE = '42501';
  END IF;
  IF p_spots IS NULL OR p_spots NOT BETWEEN 1 AND v_limit OR p_payment_method IS NULL OR p_payment_method NOT IN ('stripe', 'gcash') THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: spots must be 1 to the per-player limit and method stripe or gcash' USING ERRCODE = '22000';
  END IF;

  SELECT * INTO v_session FROM public.open_play_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Session does not exist' USING ERRCODE = 'P0002';
  END IF;
  IF v_session.status != 'open' OR (v_session.session_date + v_session.start_time) <= timezone('Asia/Manila', now()) THEN
    RAISE EXCEPTION 'SESSION_UNAVAILABLE' USING ERRCODE = 'P0001';
  END IF;

  -- Release this session's stale holds first so their spots count as free
  WITH stale AS (
    UPDATE public.bookings SET status = 'cancelled', cancel_reason = 'expired', updated_at = clock_timestamp()
    WHERE open_play_session_id = p_session_id AND court_id IS NULL AND status = 'pending'
      AND public.hold_release_after(hold_expires_at, created_at) <= clock_timestamp()
    RETURNING id
  )
  UPDATE public.payments SET status = 'failed'
  WHERE status = 'pending' AND booking_id IN (SELECT id FROM stale);

  -- GCash proofs awaiting staff (infinite hold) are paid money, not an abandoned checkout
  IF EXISTS (
    SELECT 1 FROM public.bookings
    WHERE open_play_session_id = p_session_id AND court_id IS NULL AND user_id = v_uid
      AND status = 'pending' AND hold_expires_at IS DISTINCT FROM 'infinity'
  ) THEN
    RAISE EXCEPTION 'OPEN_HOLD_EXISTS' USING ERRCODE = 'P0001';
  END IF;

  IF public.open_play_spots_taken(p_session_id) + p_spots > v_session.capacity THEN
    RAISE EXCEPTION 'SESSION_FULL' USING ERRCODE = 'P0001';
  END IF;
  IF public.open_play_player_spots(p_session_id, v_uid, NULL) + p_spots > v_limit THEN
    RAISE EXCEPTION 'PLAYER_LIMIT' USING ERRCODE = 'P0001';
  END IF;

  SELECT nullif(trim(full_name), '') INTO v_name FROM public.profiles WHERE id = v_uid;
  v_amount := p_spots * v_session.price_per_spot;

  INSERT INTO public.bookings (
    user_id, customer_name, open_play_session_id, open_play_spots, booking_date, start_time, end_time,
    status, total_amount, basket_id, hold_expires_at
  ) VALUES (
    v_uid, coalesce(v_name, 'Online Player'), p_session_id, p_spots, v_session.session_date, v_session.start_time, v_session.end_time,
    'pending', v_amount, v_basket, v_expires
  ) RETURNING id INTO v_booking_id;

  INSERT INTO public.payments (booking_id, amount, currency, status, payment_method)
  VALUES (v_booking_id, v_amount, 'php', 'pending', p_payment_method)
  RETURNING id INTO v_payment_id;

  RETURN jsonb_build_object('basket_id', v_basket, 'booking_id', v_booking_id, 'payment_id', v_payment_id,
                            'amount', v_amount, 'hold_expires_at', v_expires);
END;
$$;

REVOKE ALL ON FUNCTION public.hold_open_play_spots(uuid, int, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hold_open_play_spots(uuid, int, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.add_open_play_walkup(
  p_session_id uuid, p_customer_id uuid, p_customer_name text, p_spots int,
  p_payment_method text, p_payment_reference text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_session record;
  v_amount numeric;
  v_booking_id uuid;
  v_limit int := (SELECT max_open_play_spots_per_player FROM public.booking_settings WHERE id);
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN: Admin privileges required' USING ERRCODE = '42501';
  END IF;
  IF p_customer_id IS NULL OR trim(coalesce(p_customer_name, '')) = '' THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: customer and customer_name are required' USING ERRCODE = '22000';
  END IF;
  IF p_spots IS NULL OR p_spots NOT BETWEEN 1 AND v_limit THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: spots must be 1 to the per-player limit' USING ERRCODE = '22000';
  END IF;
  IF p_payment_method IS NULL OR p_payment_method NOT IN ('cash', 'gcash') THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: payment_method must be cash or gcash' USING ERRCODE = '22000';
  END IF;
  IF p_payment_method = 'gcash' AND trim(coalesce(p_payment_reference, '')) = '' THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: a GCash reference is required' USING ERRCODE = '22000';
  END IF;

  SELECT * INTO v_session FROM public.open_play_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Session does not exist' USING ERRCODE = 'P0002';
  END IF;
  -- Staff may add players after the start, so only the status is checked
  IF v_session.status != 'open' THEN
    RAISE EXCEPTION 'SESSION_UNAVAILABLE' USING ERRCODE = 'P0001';
  END IF;
  IF public.open_play_spots_taken(p_session_id) + p_spots > v_session.capacity THEN
    RAISE EXCEPTION 'SESSION_FULL' USING ERRCODE = 'P0001';
  END IF;
  IF public.open_play_player_spots(p_session_id, NULL, p_customer_id) + p_spots > v_limit THEN
    RAISE EXCEPTION 'PLAYER_LIMIT' USING ERRCODE = 'P0001';
  END IF;

  v_amount := p_spots * v_session.price_per_spot;

  INSERT INTO public.bookings (
    customer_id, customer_name, open_play_session_id, open_play_spots, booking_date, start_time, end_time,
    status, total_amount
  ) VALUES (
    p_customer_id, trim(p_customer_name), p_session_id, p_spots, v_session.session_date, v_session.start_time, v_session.end_time,
    'confirmed', v_amount
  ) RETURNING id INTO v_booking_id;

  INSERT INTO public.payments (booking_id, amount, currency, status, payment_method, payment_reference, paid_at)
  VALUES (v_booking_id, v_amount, 'php', 'paid', p_payment_method, p_payment_reference, now());

  RETURN jsonb_build_object('booking_id', v_booking_id, 'amount', v_amount);
END;
$$;

COMMIT;
