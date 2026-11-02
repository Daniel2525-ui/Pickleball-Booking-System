-- Open play: admin schedule save and the session generator (cron / admin).

BEGIN;

CREATE FUNCTION public.save_open_play_schedule(
  p_id uuid, p_day_of_week text, p_start_time time, p_end_time time,
  p_court_ids uuid[], p_capacity int, p_price_per_spot numeric
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN: Admin privileges required' USING ERRCODE = '42501';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.open_play_schedules (day_of_week, start_time, end_time, court_ids, capacity, price_per_spot)
    VALUES (p_day_of_week, p_start_time, p_end_time, p_court_ids, p_capacity, p_price_per_spot)
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  UPDATE public.open_play_schedules
  SET day_of_week = p_day_of_week, start_time = p_start_time, end_time = p_end_time,
      court_ids = p_court_ids, capacity = p_capacity, price_per_spot = p_price_per_spot
  WHERE id = p_id
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Schedule does not exist' USING ERRCODE = 'P0002';
  END IF;

  -- Holds lock their session row FOR UPDATE; taking the same locks keeps a racing hold from landing on a session we delete
  PERFORM 1 FROM public.open_play_sessions
  WHERE schedule_id = p_id AND session_date >= (now() AT TIME ZONE 'Asia/Manila')::date FOR UPDATE;

  -- Future sessions nobody has booked are dropped (cancelled dates stay cancelled: staff skip a date by cancelling it) so the generator rebuilds them with the new values
  -- Two statements: the bookings FK is RESTRICT, so blocks must go first
  DELETE FROM public.bookings WHERE open_play_session_id IN (
    SELECT s.id FROM public.open_play_sessions s
    WHERE s.schedule_id = p_id
      AND s.session_date >= (now() AT TIME ZONE 'Asia/Manila')::date
      AND s.status <> 'cancelled'
      AND NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.open_play_session_id = s.id AND b.court_id IS NULL)
  );
  DELETE FROM public.open_play_sessions WHERE id IN (
    SELECT s.id FROM public.open_play_sessions s
    WHERE s.schedule_id = p_id
      AND s.session_date >= (now() AT TIME ZONE 'Asia/Manila')::date
      AND s.status <> 'cancelled'
      AND NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.open_play_session_id = s.id AND b.court_id IS NULL)
  );
  RETURN v_id;
END;
$$;

CREATE FUNCTION public.set_open_play_schedule_active(p_id uuid, p_active boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN: Admin privileges required' USING ERRCODE = '42501';
  END IF;
  UPDATE public.open_play_schedules SET active = p_active WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Schedule does not exist' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

CREATE FUNCTION public.generate_open_play_sessions(p_days int DEFAULT 28)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Manila')::date;
  r record;
  v_dow text;
  v_open boolean;
  v_from time;
  v_to time;
  v_reason text;
  v_created int := 0;
  v_flagged int := 0;
BEGIN
  IF NOT (coalesce(auth.role(), '') = 'service_role' OR public.is_admin()) THEN
    RAISE EXCEPTION 'FORBIDDEN: Admin privileges required' USING ERRCODE = '42501';
  END IF;

  FOR r IN
    SELECT sc.*, d::date AS d
    FROM public.open_play_schedules sc
    CROSS JOIN generate_series(v_today, v_today + (p_days - 1), interval '1 day') d
    LEFT JOIN public.open_play_sessions se ON se.schedule_id = sc.id AND se.session_date = d::date
    WHERE sc.active
      AND (se.id IS NULL OR se.status = 'flagged')
      AND CASE date_part('dow', d)::integer
        WHEN 0 THEN 'Sunday' WHEN 1 THEN 'Monday' WHEN 2 THEN 'Tuesday' WHEN 3 THEN 'Wednesday'
        WHEN 4 THEN 'Thursday' WHEN 5 THEN 'Friday' WHEN 6 THEN 'Saturday'
      END = sc.day_of_week
    ORDER BY d, sc.id
  LOOP
    v_reason := NULL;

    SELECT is_open, open_time, close_time INTO v_open, v_from, v_to
    FROM public.operating_hours WHERE day_of_week = r.day_of_week;
    IF NOT coalesce(v_open, false) OR v_from IS NULL OR v_to IS NULL
       OR r.start_time < v_from OR r.end_time > v_to THEN
      v_reason := 'Venue closed';
    END IF;

    IF v_reason IS NULL THEN
      SELECT 'Court ' || name || ' is ' || status INTO v_reason
      FROM public.courts WHERE id = ANY (r.court_ids) AND status <> 'active'
      ORDER BY name LIMIT 1;
    END IF;

    IF v_reason IS NULL AND (SELECT count(*) FROM public.courts WHERE id = ANY (r.court_ids)) < cardinality(r.court_ids) THEN
      v_reason := 'A court no longer exists';
    END IF;

    IF v_reason IS NULL THEN
      BEGIN
        INSERT INTO public.open_play_sessions (schedule_id, session_date, start_time, end_time, court_ids, capacity, price_per_spot, status)
        VALUES (r.id, r.d, r.start_time, r.end_time, r.court_ids, r.capacity, r.price_per_spot, 'open')
        ON CONFLICT (schedule_id, session_date) DO UPDATE
          SET status = 'open', flag_reason = NULL, start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time,
              court_ids = EXCLUDED.court_ids, capacity = EXCLUDED.capacity, price_per_spot = EXCLUDED.price_per_spot;

        INSERT INTO public.bookings (court_id, open_play_session_id, booking_date, start_time, end_time, status, total_amount, customer_name)
        SELECT c, (SELECT id FROM public.open_play_sessions WHERE schedule_id = r.id AND session_date = r.d),
               r.d, r.start_time, r.end_time, 'confirmed', 0, 'Open play'
        FROM unnest(r.court_ids) c;
        v_created := v_created + 1;
        CONTINUE;
      EXCEPTION WHEN exclusion_violation THEN
        SELECT 'Court ' || c.name || ' already booked '
               || to_char(b.start_time, 'FMHH12:MI AM') || '–' || to_char(b.end_time, 'FMHH12:MI AM')
        INTO v_reason
        FROM public.bookings b JOIN public.courts c ON c.id = b.court_id
        WHERE b.court_id = ANY (r.court_ids) AND b.booking_date = r.d
          AND b.status IN ('confirmed', 'checked_in', 'in_progress', 'completed', 'pending')
          AND b.start_time < r.end_time AND b.end_time > r.start_time
        ORDER BY b.start_time LIMIT 1;
        v_reason := coalesce(v_reason, 'Court already booked');
      END;
    END IF;

    INSERT INTO public.open_play_sessions (schedule_id, session_date, start_time, end_time, court_ids, capacity, price_per_spot, status, flag_reason)
    VALUES (r.id, r.d, r.start_time, r.end_time, r.court_ids, r.capacity, r.price_per_spot, 'flagged', v_reason)
    ON CONFLICT (schedule_id, session_date) DO UPDATE SET flag_reason = EXCLUDED.flag_reason;
    v_flagged := v_flagged + 1;
  END LOOP;

  RETURN jsonb_build_object('created', v_created, 'flagged', v_flagged);
END;
$$;

REVOKE ALL ON FUNCTION public.save_open_play_schedule(uuid, text, time, time, uuid[], int, numeric),
  public.set_open_play_schedule_active(uuid, boolean),
  public.generate_open_play_sessions(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_open_play_schedule(uuid, text, time, time, uuid[], int, numeric),
  public.set_open_play_schedule_active(uuid, boolean),
  public.generate_open_play_sessions(int) TO authenticated, service_role;

COMMIT;
