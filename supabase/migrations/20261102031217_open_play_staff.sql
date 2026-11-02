-- Open play: staff walk-ups and session cancellation.

BEGIN;

CREATE FUNCTION public.add_open_play_walkup(
  p_session_id uuid, p_customer_id uuid, p_customer_name text, p_spots int,
  p_payment_method text, p_payment_reference text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_session record;
  v_amount numeric;
  v_booking_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN: Admin privileges required' USING ERRCODE = '42501';
  END IF;
  IF p_customer_id IS NULL OR trim(coalesce(p_customer_name, '')) = '' THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: customer and customer_name are required' USING ERRCODE = '22000';
  END IF;
  IF p_spots IS NULL OR p_spots NOT BETWEEN 1 AND 4 THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: spots must be 1-4' USING ERRCODE = '22000';
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
  IF public.open_play_player_spots(p_session_id, NULL, p_customer_id) + p_spots > 4 THEN
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

CREATE FUNCTION public.cancel_open_play_session(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_ids uuid[];
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN: Admin privileges required' USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM public.open_play_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Session does not exist' USING ERRCODE = 'P0002';
  END IF;

  -- Lock the spot rows so a concurrent GCash proof submit can't slip in between the check and the update
  PERFORM 1 FROM public.bookings WHERE open_play_session_id = p_session_id AND court_id IS NULL FOR UPDATE;

  IF EXISTS (
    SELECT 1 FROM public.bookings
    WHERE open_play_session_id = p_session_id AND status = 'pending' AND hold_expires_at = 'infinity'
  ) THEN
    RAISE EXCEPTION 'GCASH_PENDING_VERIFICATION: Verify or reject the waiting GCash payments first' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.open_play_sessions SET status = 'cancelled' WHERE id = p_session_id;

  WITH c AS (
    UPDATE public.bookings
    SET status = 'cancelled', cancel_reason = 'admin', hold_expires_at = NULL, updated_at = clock_timestamp()
    WHERE open_play_session_id = p_session_id AND status != 'cancelled'
    RETURNING id, court_id
  ), p AS (
    UPDATE public.payments SET status = 'failed'
    WHERE status = 'pending' AND booking_id IN (SELECT id FROM c)
  )
  SELECT coalesce(array_agg(id) FILTER (WHERE court_id IS NULL), '{}') INTO v_ids FROM c;

  RETURN jsonb_build_object('cancelled', cardinality(v_ids), 'booking_ids', to_jsonb(v_ids));
END;
$$;

REVOKE ALL ON FUNCTION public.add_open_play_walkup(uuid, uuid, text, int, text, text), public.cancel_open_play_session(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_open_play_walkup(uuid, uuid, text, int, text, text), public.cancel_open_play_session(uuid) TO authenticated;

COMMIT;
