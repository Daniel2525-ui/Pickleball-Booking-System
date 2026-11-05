-- Rollback for 20261105060451_move_after_price_change.sql: restores move_booking from 20261105042752

BEGIN;

CREATE OR REPLACE FUNCTION public.move_booking(
  p_booking_id uuid,
  p_court_id uuid,
  p_booking_date date,
  p_start_time time
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_now timestamp := timezone('Asia/Manila', now());
  v_end time;
  v_day text;
  v_is_open boolean;
  v_open time;
  v_close time;
  v_court_status text;
  v_conflict uuid;
  v_price numeric;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN: Admin privileges required to move bookings' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Booking does not exist' USING ERRCODE = 'P0002';
  END IF;

  -- Only a confirmed court booking that has not started (open play blocks and spots are managed on Open Play)
  IF v_booking.court_id IS NULL OR v_booking.open_play_session_id IS NOT NULL THEN
    RAISE EXCEPTION 'NOT_MOVABLE: Open play is managed on the Open Play page' USING ERRCODE = 'P0001';
  END IF;
  IF v_booking.status <> 'confirmed' THEN
    RAISE EXCEPTION 'NOT_MOVABLE: Only confirmed bookings that have not started can be moved' USING ERRCODE = 'P0001';
  END IF;
  IF (v_booking.booking_date + v_booking.start_time) <= v_now THEN
    RAISE EXCEPTION 'NOT_MOVABLE: This booking has already started' USING ERRCODE = 'P0001';
  END IF;

  IF date_part('minute', p_start_time) <> 0 OR date_part('second', p_start_time) <> 0 THEN
    RAISE EXCEPTION 'INVALID_TIME_INCREMENT: Bookings start on the hour' USING ERRCODE = '22000';
  END IF;

  -- Same length as before; a slot that would run past midnight is outside opening hours
  v_end := p_start_time + (v_booking.end_time - v_booking.start_time);
  IF v_end <= p_start_time THEN
    RAISE EXCEPTION 'OUTSIDE_OPERATING_HOURS: The new time runs past closing' USING ERRCODE = '22000';
  END IF;
  IF (p_booking_date + p_start_time) <= v_now THEN
    RAISE EXCEPTION 'PAST_SLOT: The new time has already started' USING ERRCODE = '22000';
  END IF;
  IF p_court_id = v_booking.court_id AND p_booking_date = v_booking.booking_date AND p_start_time = v_booking.start_time THEN
    RAISE EXCEPTION 'NO_CHANGE: The booking is already at that court and time' USING ERRCODE = '22000';
  END IF;

  v_day := trim(to_char(p_booking_date, 'Day'));
  SELECT is_open, open_time, close_time INTO v_is_open, v_open, v_close
  FROM public.operating_hours WHERE day_of_week = v_day;
  IF NOT FOUND OR NOT v_is_open OR v_open IS NULL OR v_close IS NULL THEN
    RAISE EXCEPTION 'VENUE_CLOSED: The venue is closed on that day' USING ERRCODE = 'P0001';
  END IF;
  IF p_start_time < v_open OR v_end > v_close THEN
    RAISE EXCEPTION 'OUTSIDE_OPERATING_HOURS: The new time is outside opening hours' USING ERRCODE = '22000';
  END IF;

  -- Lock the target court, as walk-ins do, so two moves can't take the same slot
  SELECT status INTO v_court_status FROM public.courts WHERE id = p_court_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Court does not exist' USING ERRCODE = 'P0002';
  END IF;
  IF lower(coalesce(v_court_status, '')) <> 'active' THEN
    RAISE EXCEPTION 'COURT_UNAVAILABLE: That court is closed for maintenance' USING ERRCODE = 'P0001';
  END IF;

  PERFORM public.release_expired_court_holds(p_court_id, p_booking_date, p_start_time, v_end);

  SELECT id INTO v_conflict
  FROM public.bookings
  WHERE court_id = p_court_id
    AND booking_date = p_booking_date
    AND id <> v_booking.id
    AND (
      status IN ('confirmed', 'checked_in', 'in_progress', 'completed')
      OR (status = 'pending' AND public.hold_release_after(hold_expires_at, created_at) > clock_timestamp())
    )
    AND start_time < v_end
    AND end_time > p_start_time
  LIMIT 1;
  IF v_conflict IS NOT NULL THEN
    RAISE EXCEPTION 'SLOT_UNAVAILABLE' USING ERRCODE = 'P0001';
  END IF;

  -- The payment stays as it is, so the new slot must cost the same
  v_price := public.quote_court_price(p_booking_date, p_start_time, v_end);
  IF v_price <> v_booking.total_amount THEN
    RAISE EXCEPTION 'PRICE_CHANGES: %|%', v_booking.total_amount, v_price USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    UPDATE public.bookings
    SET court_id = p_court_id, booking_date = p_booking_date, start_time = p_start_time, end_time = v_end, updated_at = now()
    WHERE id = v_booking.id;
  EXCEPTION WHEN exclusion_violation THEN
    RAISE EXCEPTION 'SLOT_UNAVAILABLE' USING ERRCODE = 'P0001';
  END;

  RETURN jsonb_build_object(
    'booking_id', v_booking.id,
    'court_id', p_court_id,
    'booking_date', p_booking_date,
    'start_time', p_start_time,
    'end_time', v_end
  );
END;
$$;

COMMIT;
