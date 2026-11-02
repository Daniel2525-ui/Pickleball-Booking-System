-- Rollback for 20261103000001_open_play_one_hold_per_player.sql: restores hold_open_play_spots without the OPEN_HOLD_EXISTS check.

BEGIN;

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
BEGIN
  IF v_uid IS NULL OR coalesce(auth.role(), '') != 'authenticated' THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required to hold spots' USING ERRCODE = '42501';
  END IF;
  IF p_spots IS NULL OR p_spots NOT BETWEEN 1 AND 4 OR p_payment_method IS NULL OR p_payment_method NOT IN ('stripe', 'gcash') THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: spots must be 1-4 and method stripe or gcash' USING ERRCODE = '22000';
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

  IF public.open_play_spots_taken(p_session_id) + p_spots > v_session.capacity THEN
    RAISE EXCEPTION 'SESSION_FULL' USING ERRCODE = 'P0001';
  END IF;
  IF public.open_play_player_spots(p_session_id, v_uid, NULL) + p_spots > 4 THEN
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

COMMIT;
