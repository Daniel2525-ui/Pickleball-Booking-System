-- Open play: staff can add a one-time session on a specific date, besides the weekly schedules.
-- A one-time session is an open_play_sessions row with no schedule; booking, cancelling and the players panel already work per session.

BEGIN;

ALTER TABLE public.open_play_sessions ALTER COLUMN schedule_id DROP NOT NULL;

-- Same checks as generate_open_play_sessions, but staff get the reason as an error instead of a flagged row.
-- The block rows below also pass the closed-date trigger (VENUE_CLOSED) and the court overlap constraint.
CREATE FUNCTION public.create_open_play_session(
  p_date date, p_start_time time, p_end_time time, p_court_ids uuid[], p_capacity int, p_price_per_spot numeric
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_id uuid;
  v_reason text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN: Admin privileges required' USING ERRCODE = '42501';
  END IF;
  IF p_date IS NULL OR p_start_time IS NULL OR p_end_time IS NULL OR p_end_time <= p_start_time
     OR p_start_time <> date_trunc('hour', p_start_time) OR p_end_time <> date_trunc('hour', p_end_time) THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Pick a date and whole-hour start and end times, ending after the start' USING ERRCODE = '22000';
  END IF;
  IF coalesce(cardinality(p_court_ids), 0) < 1 THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Choose at least one court' USING ERRCODE = '22000';
  END IF;
  IF p_capacity IS NULL OR p_capacity < 1 OR p_price_per_spot IS NULL OR p_price_per_spot <= 0 THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Spots and price must be more than zero' USING ERRCODE = '22000';
  END IF;
  IF (p_date + p_start_time) <= timezone('Asia/Manila', now()) THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: The session must start in the future' USING ERRCODE = '22000';
  END IF;
  IF NOT public.within_bookable_hours(p_date, p_start_time, p_end_time) THEN
    RAISE EXCEPTION 'VENUE_CLOSED: The venue is not open for those hours on that date' USING ERRCODE = 'P0001';
  END IF;
  SELECT name || ' is ' || status INTO v_reason
  FROM public.courts WHERE id = ANY (p_court_ids) AND status <> 'active' ORDER BY name LIMIT 1;
  IF v_reason IS NULL AND (SELECT count(*) FROM public.courts WHERE id = ANY (p_court_ids)) < cardinality(p_court_ids) THEN
    v_reason := 'A court no longer exists';
  END IF;
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION 'COURT_UNAVAILABLE: %', v_reason USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.open_play_sessions (schedule_id, session_date, start_time, end_time, court_ids, capacity, price_per_spot, status)
  VALUES (NULL, p_date, p_start_time, p_end_time, p_court_ids, p_capacity, p_price_per_spot, 'open')
  RETURNING id INTO v_id;

  BEGIN
    INSERT INTO public.bookings (court_id, open_play_session_id, booking_date, start_time, end_time, status, total_amount, customer_name)
    SELECT c, v_id, p_date, p_start_time, p_end_time, 'confirmed', 0, 'Open play' FROM unnest(p_court_ids) c;
  EXCEPTION WHEN exclusion_violation THEN
    SELECT c.name || ' is already booked '
           || to_char(b.start_time, 'FMHH12:MI AM') || '–' || to_char(b.end_time, 'FMHH12:MI AM')
    INTO v_reason
    FROM public.bookings b JOIN public.courts c ON c.id = b.court_id
    WHERE b.court_id = ANY (p_court_ids) AND b.booking_date = p_date
      AND b.status IN ('confirmed', 'checked_in', 'in_progress', 'completed', 'pending')
      AND b.start_time < p_end_time AND b.end_time > p_start_time
    ORDER BY b.start_time LIMIT 1;
    -- The session row above is rolled back with the error
    RAISE EXCEPTION 'COURT_BOOKED: %', coalesce(v_reason, 'A court is already booked then') USING ERRCODE = 'P0001';
  END;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_open_play_session(date, time, time, uuid[], int, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_open_play_session(date, time, time, uuid[], int, numeric) TO authenticated;

COMMIT;
