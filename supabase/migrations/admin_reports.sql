-- ==============================================================================
-- Migration: admin_reports
-- get_venue_report(p_from, p_to): every number on the Admin Reports page for a period, in one read-only call.
-- Definitions: docs/superpowers/specs/2026-11-05-admin-reports-design.md. Money is dated by paid_at in Asia/Manila;
-- net = paid amounts only (a refunded payment is already status 'refunded', so refunds are never subtracted twice).
-- SECURITY INVOKER: it reads through the caller's RLS, and only Admins (is_owner) may call it.
-- ==============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_venue_report(p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO ''
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Manila')::date;
  v_to date := coalesce(p_to, v_today);
  v_from date;
  v_through date;
  v_bucket text;
  v_len int;
  v_courts int;
  v_money jsonb;
  v_bookings jsonb;
  v_previous jsonb;
  v_occupancy jsonb;
  v_court_rows jsonb;
  v_heatmap jsonb;
  v_series jsonb;
  v_top jsonb;
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'FORBIDDEN: Admin privileges required' USING ERRCODE = '42501';
  END IF;

  -- All time starts at the first booking or payment (LEAST skips NULLs)
  v_from := coalesce(p_from, least(
    (SELECT min(booking_date) FROM public.bookings),
    (SELECT min((paid_at AT TIME ZONE 'Asia/Manila')::date) FROM public.payments WHERE paid_at IS NOT NULL),
    v_to));
  IF v_to < v_from OR v_to - v_from > 3660 THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: The period must end on or after its start and span at most 10 years' USING ERRCODE = '22000';
  END IF;
  v_through := least(v_to, v_today); -- occupancy only counts days that have happened
  v_len := v_to - v_from + 1;
  v_bucket := CASE WHEN v_len <= 62 THEN 'day' ELSE 'month' END;
  SELECT count(*) INTO v_courts FROM public.courts;

  -- Money, dated by when it was paid
  SELECT jsonb_build_object(
    'net', coalesce(sum(p.amount) FILTER (WHERE p.status = 'paid'), 0),
    'cash', coalesce(sum(p.amount) FILTER (WHERE p.status = 'paid' AND p.payment_method = 'cash'), 0),
    'gcash', coalesce(sum(p.amount) FILTER (WHERE p.status = 'paid' AND p.payment_method = 'gcash'), 0),
    'card', coalesce(sum(p.amount) FILTER (WHERE p.status = 'paid' AND coalesce(p.payment_method, '') NOT IN ('cash', 'gcash')), 0),
    'refunded', coalesce(sum(p.amount) FILTER (WHERE p.status = 'refunded'), 0),
    'refunded_count', count(*) FILTER (WHERE p.status = 'refunded'),
    'court', coalesce(sum(p.amount) FILTER (WHERE p.status = 'paid' AND b.open_play_session_id IS NULL), 0),
    'open_play', coalesce(sum(p.amount) FILTER (WHERE p.status = 'paid' AND b.open_play_session_id IS NOT NULL), 0))
  INTO v_money
  FROM public.payments p JOIN public.bookings b ON b.id = p.booking_id
  WHERE (p.paid_at AT TIME ZONE 'Asia/Manila')::date BETWEEN v_from AND v_to;

  -- Court bookings (not open-play blocks or spots), dated by their booking date
  WITH cb AS (
    SELECT b.*, extract(epoch FROM (b.end_time - b.start_time)) / 3600 AS hours
    FROM public.bookings b
    WHERE b.court_id IS NOT NULL AND b.open_play_session_id IS NULL AND b.booking_date BETWEEN v_from AND v_to
  )
  SELECT jsonb_build_object(
    'count', count(*) FILTER (WHERE status IN ('confirmed', 'checked_in', 'in_progress', 'completed', 'no_show')),
    'court_hours', round(coalesce(sum(hours) FILTER (WHERE status IN ('confirmed', 'checked_in', 'in_progress', 'completed', 'no_show')), 0), 1),
    'cancelled', count(*) FILTER (WHERE status = 'cancelled' AND cancel_reason IN ('customer', 'admin', 'payment_kept')),
    'no_shows', count(*) FILTER (WHERE status = 'no_show'),
    'money_kept', coalesce((SELECT sum(p.amount) FROM public.payments p JOIN cb k ON k.id = p.booking_id
                            WHERE p.status = 'paid' AND (k.status = 'no_show' OR (k.status = 'cancelled' AND k.cancel_reason = 'payment_kept'))), 0))
  INTO v_bookings
  FROM cb;

  -- The same length of time just before (none for all time)
  IF p_from IS NOT NULL THEN
    SELECT jsonb_build_object(
      'net', coalesce((SELECT sum(amount) FROM public.payments
                       WHERE status = 'paid' AND (paid_at AT TIME ZONE 'Asia/Manila')::date BETWEEN v_from - v_len AND v_from - 1), 0),
      'count', count(*) FILTER (WHERE status IN ('confirmed', 'checked_in', 'in_progress', 'completed', 'no_show')),
      'cancelled_and_no_shows', count(*) FILTER (WHERE status = 'no_show' OR (status = 'cancelled' AND cancel_reason IN ('customer', 'admin', 'payment_kept'))))
    INTO v_previous
    FROM public.bookings
    WHERE court_id IS NOT NULL AND open_play_session_id IS NULL AND booking_date BETWEEN v_from - v_len AND v_from - 1;
  END IF;

  -- Open hours per day up to today (closed weekdays and closure dates give none; a 00:00 close means midnight),
  -- booked court-hours (every live booking on a court, open-play blocks included), and the weekday x hour grid
  WITH days AS (
    SELECT d::date AS d, extract(isodow FROM d)::int - 1 AS dow,
           extract(hour FROM h.open_time)::int AS open_h,
           CASE WHEN h.close_time = '00:00' THEN 24 ELSE extract(hour FROM h.close_time)::int END AS close_h
    FROM generate_series(v_from, v_through, interval '1 day') d
    JOIN public.operating_hours h ON h.day_of_week = trim(to_char(d, 'Day')) AND h.is_open
    WHERE h.open_time IS NOT NULL AND h.close_time IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.venue_closures c WHERE c.closed_on = d::date)
  ), booked AS (
    SELECT b.court_id, b.booking_date,
           b.start_time - time '00:00' AS s, b.end_time - time '00:00' AS e,
           extract(epoch FROM (b.end_time - b.start_time)) / 3600 AS hours
    FROM public.bookings b
    WHERE b.court_id IS NOT NULL AND b.status NOT IN ('cancelled', 'pending') AND b.booking_date BETWEEN v_from AND v_through
  ), per_court AS (
    SELECT coalesce(sum(close_h - open_h), 0) AS open_h FROM days
  ), slots AS (
    SELECT dow, hr, count(*) * v_courts AS available
    FROM days, generate_series(open_h, close_h - 1) hr
    GROUP BY dow, hr
  ), used AS (
    SELECT extract(isodow FROM k.booking_date)::int - 1 AS dow, hr,
           sum(extract(epoch FROM (least(k.e, make_interval(hours => hr + 1)) - greatest(k.s, make_interval(hours => hr)))) / 3600) AS hours
    FROM booked k JOIN generate_series(0, 23) hr ON k.s < make_interval(hours => hr + 1) AND k.e > make_interval(hours => hr)
    WHERE EXISTS (SELECT 1 FROM days WHERE days.d = k.booking_date)
    GROUP BY 1, 2
  )
  SELECT
    jsonb_build_object(
      'pct', CASE WHEN pc.open_h * v_courts = 0 THEN NULL ELSE round(100 * coalesce((SELECT sum(hours) FROM booked), 0) / (pc.open_h * v_courts)) END,
      'booked_hours', round(coalesce((SELECT sum(hours) FROM booked), 0), 1),
      'open_hours', pc.open_h * v_courts),
    coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name,
        'pct', CASE WHEN pc.open_h = 0 THEN NULL
               ELSE round(100 * coalesce((SELECT sum(hours) FROM booked k WHERE k.court_id = c.id), 0) / pc.open_h) END)
      ORDER BY c.name) FROM public.courts c), '[]'::jsonb),
    coalesce((SELECT jsonb_agg(jsonb_build_object('dow', sl.dow, 'hour', sl.hr, 'pct', least(100, round(100 * coalesce(u.hours, 0) / sl.available)))
                               ORDER BY sl.dow, sl.hr)
              FROM slots sl LEFT JOIN used u ON u.dow = sl.dow AND u.hr = sl.hr), '[]'::jsonb)
  INTO v_occupancy, v_court_rows, v_heatmap
  FROM per_court pc;

  -- One row per day (or month for long periods), empty ones included
  WITH buckets AS (
    SELECT CASE WHEN v_bucket = 'day' THEN to_char(g, 'YYYY-MM-DD') ELSE to_char(g, 'YYYY-MM') END AS key
    FROM generate_series(CASE WHEN v_bucket = 'day' THEN v_from ELSE date_trunc('month', v_from)::date END,
                         v_to, CASE WHEN v_bucket = 'day' THEN interval '1 day' ELSE interval '1 month' END) g
  ), money AS (
    SELECT CASE WHEN v_bucket = 'day' THEN to_char(pd, 'YYYY-MM-DD') ELSE to_char(pd, 'YYYY-MM') END AS key,
           sum(amount) FILTER (WHERE status = 'paid') AS net,
           sum(amount) FILTER (WHERE status = 'paid' AND payment_method = 'cash') AS cash,
           sum(amount) FILTER (WHERE status = 'paid' AND payment_method = 'gcash') AS gcash,
           sum(amount) FILTER (WHERE status = 'paid' AND coalesce(payment_method, '') NOT IN ('cash', 'gcash')) AS card,
           sum(amount) FILTER (WHERE status = 'refunded') AS refunded
    FROM (SELECT p.*, (p.paid_at AT TIME ZONE 'Asia/Manila')::date AS pd FROM public.payments p) x
    WHERE pd BETWEEN v_from AND v_to
    GROUP BY 1
  ), books AS (
    SELECT CASE WHEN v_bucket = 'day' THEN to_char(booking_date, 'YYYY-MM-DD') ELSE to_char(booking_date, 'YYYY-MM') END AS key,
           count(*) AS bookings, sum(extract(epoch FROM (end_time - start_time)) / 3600) AS hours
    FROM public.bookings
    WHERE court_id IS NOT NULL AND open_play_session_id IS NULL AND booking_date BETWEEN v_from AND v_to
      AND status IN ('confirmed', 'checked_in', 'in_progress', 'completed', 'no_show')
    GROUP BY 1
  )
  SELECT jsonb_agg(jsonb_build_object(
      'key', bk.key, 'net', coalesce(m.net, 0), 'cash', coalesce(m.cash, 0), 'gcash', coalesce(m.gcash, 0),
      'card', coalesce(m.card, 0), 'refunded', coalesce(m.refunded, 0),
      'bookings', coalesce(k.bookings, 0), 'court_hours', round(coalesce(k.hours, 0), 1)) ORDER BY bk.key)
  INTO v_series
  FROM buckets bk LEFT JOIN money m ON m.key = bk.key LEFT JOIN books k ON k.key = bk.key;

  -- Best customers: an account, else a walk-in record, else the name on the booking
  WITH tagged AS (
    SELECT b.*, coalesce('u:' || b.user_id, 'c:' || b.customer_id, 'n:' || lower(b.customer_name)) AS who,
           coalesce(pr.full_name, cu.full_name, b.customer_name) AS who_name
    FROM public.bookings b
    LEFT JOIN public.profiles pr ON pr.id = b.user_id
    LEFT JOIN public.customers cu ON cu.id = b.customer_id
  ), visits AS (
    SELECT who, count(*) AS visits, sum(extract(epoch FROM (end_time - start_time)) / 3600) AS hours,
           max(booking_date) FILTER (WHERE booking_date <= v_today) AS last_visit
    FROM tagged
    WHERE court_id IS NOT NULL AND open_play_session_id IS NULL AND booking_date BETWEEN v_from AND v_to
      AND status IN ('confirmed', 'checked_in', 'in_progress', 'completed', 'no_show')
    GROUP BY who
  ), spent AS (
    SELECT t.who, sum(p.amount) AS spent
    FROM public.payments p JOIN tagged t ON t.id = p.booking_id
    WHERE p.status = 'paid' AND (p.paid_at AT TIME ZONE 'Asia/Manila')::date BETWEEN v_from AND v_to
    GROUP BY t.who
  ), ranked AS (
    SELECT coalesce(v.who, s.who) AS who, coalesce(v.visits, 0) AS visits, coalesce(v.hours, 0) AS hours,
           coalesce(s.spent, 0) AS spent, v.last_visit
    FROM visits v FULL JOIN spent s ON s.who = v.who
    ORDER BY coalesce(s.spent, 0) DESC, coalesce(v.visits, 0) DESC
    LIMIT 5
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'name', (SELECT t.who_name FROM tagged t WHERE t.who = r.who LIMIT 1),
      'visits', r.visits, 'hours', round(r.hours, 1), 'spent', r.spent, 'last_visit', r.last_visit)
    ORDER BY r.spent DESC, r.visits DESC), '[]'::jsonb)
  INTO v_top
  FROM ranked r;

  RETURN jsonb_build_object(
    'period', jsonb_build_object('from', v_from, 'to', v_to, 'through', v_through, 'bucket', v_bucket),
    'money', v_money, 'bookings', v_bookings, 'previous', v_previous, 'occupancy', v_occupancy,
    'courts', v_court_rows, 'heatmap', v_heatmap, 'series', coalesce(v_series, '[]'::jsonb), 'top_customers', v_top);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_venue_report(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_venue_report(date, date) TO authenticated;

COMMIT;
