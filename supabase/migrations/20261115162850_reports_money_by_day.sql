-- Reports: money the way the drawer sees it, plus the gaps found on 2026-11-16.
-- 1. Money in counts on the day it was paid (even if refunded later); refunds count on the day they were
--    completed (refund_requests.processed_at). Net = money in - refunds. Matches the Payments page totals.
-- 2. Cash / QR Ph are money taken, so they match the drawer and Xendit; Refunded is shown beside them.
-- 3. bookings.discounts: discount codes' cost on bookings that went ahead.
-- 4. Court blocks are taken out of the open hours occupancy is measured against.
-- 5. A court counts for a period if it is active now or was booked in that period (not only today's list).
-- 7. open_play_sessions: sessions held, spots sold and how full they were.
-- 8. outstanding: money still to collect, and refunds owed, for bookings in the period.

BEGIN;

CREATE OR REPLACE FUNCTION public.venue_report_window(p_from date, p_to date)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO ''
AS $function$
  SELECT jsonb_build_object(
    'net', coalesce((SELECT sum(amount) FROM public.payments
                     WHERE status IN ('paid', 'refunded') AND public.business_day_of(paid_at) BETWEEN p_from AND p_to), 0)
         - coalesce((SELECT sum(amount) FROM public.refund_requests
                     WHERE status IN ('succeeded', 'cash_refunded') AND public.business_day_of(processed_at) BETWEEN p_from AND p_to), 0),
    'count', count(*) FILTER (WHERE status IN ('confirmed', 'checked_in', 'in_progress', 'completed', 'no_show')),
    'cancelled_and_no_shows', count(*) FILTER (WHERE status = 'no_show' OR (status = 'cancelled' AND cancel_reason IN ('customer', 'admin', 'payment_kept'))))
  FROM public.bookings
  WHERE court_id IS NOT NULL AND open_play_session_id IS NULL AND business_date BETWEEN p_from AND p_to;
$function$;

CREATE OR REPLACE FUNCTION public.get_venue_report(p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_today date := public.business_day_of(now());
  v_to date := coalesce(p_to, v_today);
  v_from date;
  v_through date;
  v_bucket text;
  v_len int;
  v_court_ids uuid[];
  v_courts int;
  v_money jsonb;
  v_bookings jsonb;
  v_previous jsonb;
  v_so_far jsonb;
  v_occupancy jsonb;
  v_court_rows jsonb;
  v_heatmap jsonb;
  v_series jsonb;
  v_top jsonb;
  v_open_play jsonb;
  v_outstanding jsonb;
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'FORBIDDEN: Admin privileges required' USING ERRCODE = '42501';
  END IF;

  v_from := coalesce(p_from, least(
    (SELECT min(business_date) FROM public.bookings),
    (SELECT min(public.business_day_of(paid_at)) FROM public.payments WHERE paid_at IS NOT NULL),
    v_to));
  IF v_to < v_from OR v_to - v_from > 3660 THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: The period must end on or after its start and span at most 10 years' USING ERRCODE = '22000';
  END IF;
  v_through := least(v_to, v_today);
  v_len := v_to - v_from + 1;
  v_bucket := CASE WHEN v_len <= 62 THEN 'day' ELSE 'month' END;

  -- 5. Courts measured: active now, or booked during the period (a court in maintenance today still counts for last month)
  SELECT coalesce(array_agg(c.id), '{}') INTO v_court_ids
  FROM public.courts c
  WHERE coalesce(c.status, '') NOT IN ('maintenance', 'closed')
     OR EXISTS (SELECT 1 FROM public.bookings b WHERE b.court_id = c.id AND b.business_date BETWEEN v_from AND v_through
                AND b.status NOT IN ('cancelled', 'pending'));
  v_courts := cardinality(v_court_ids);

  -- 1, 2. Money in by the day it was paid; refunds by the day they were completed
  WITH paid AS (
    SELECT p.amount, p.payment_method, b.open_play_session_id IS NOT NULL AS op
    FROM public.payments p JOIN public.bookings b ON b.id = p.booking_id
    WHERE p.status IN ('paid', 'refunded') AND public.business_day_of(p.paid_at) BETWEEN v_from AND v_to
  ), back AS (
    SELECT r.amount, b.open_play_session_id IS NOT NULL AS op
    FROM public.refund_requests r JOIN public.payments p ON p.id = r.payment_id JOIN public.bookings b ON b.id = p.booking_id
    WHERE r.status IN ('succeeded', 'cash_refunded') AND public.business_day_of(r.processed_at) BETWEEN v_from AND v_to
  ), t AS (
    SELECT
      (SELECT coalesce(sum(amount), 0) FROM paid) AS gross,
      (SELECT coalesce(sum(amount), 0) FROM paid WHERE payment_method = 'cash') AS cash,
      (SELECT coalesce(sum(amount), 0) FROM paid WHERE payment_method = 'gcash') AS gcash,
      (SELECT coalesce(sum(amount), 0) FROM paid WHERE coalesce(payment_method, '') NOT IN ('cash', 'gcash')) AS card,
      (SELECT coalesce(sum(amount), 0) FROM back) AS refunded,
      (SELECT count(*) FROM back) AS refunded_count,
      (SELECT coalesce(sum(amount), 0) FROM paid WHERE NOT op) - (SELECT coalesce(sum(amount), 0) FROM back WHERE NOT op) AS court,
      (SELECT coalesce(sum(amount), 0) FROM paid WHERE op) - (SELECT coalesce(sum(amount), 0) FROM back WHERE op) AS open_play
  )
  SELECT jsonb_build_object('net', gross - refunded, 'cash', cash, 'gcash', gcash, 'card', card, 'refunded', refunded,
                            'refunded_count', refunded_count, 'court', court, 'open_play', open_play)
  INTO v_money FROM t;

  WITH cb AS (
    SELECT b.*, extract(epoch FROM (b.end_time - b.start_time)) / 3600 AS hours
    FROM public.bookings b
    WHERE b.court_id IS NOT NULL AND b.open_play_session_id IS NULL AND b.business_date BETWEEN v_from AND v_to
  )
  SELECT jsonb_build_object(
    'count', count(*) FILTER (WHERE status IN ('confirmed', 'checked_in', 'in_progress', 'completed', 'no_show')),
    'court_hours', round(coalesce(sum(hours) FILTER (WHERE status IN ('confirmed', 'checked_in', 'in_progress', 'completed', 'no_show')), 0), 1),
    'cancelled', count(*) FILTER (WHERE status = 'cancelled' AND cancel_reason IN ('customer', 'admin', 'payment_kept')),
    'no_shows', count(*) FILTER (WHERE status = 'no_show'),
    'money_kept', coalesce((SELECT sum(p.amount) FROM public.payments p JOIN cb k ON k.id = p.booking_id
                            WHERE p.status = 'paid' AND (k.status = 'no_show' OR (k.status = 'cancelled' AND k.cancel_reason = 'payment_kept'))), 0),
    -- 3. What discount codes took off bookings that went ahead
    'discounts', coalesce(sum(discount_amount) FILTER (WHERE status IN ('confirmed', 'checked_in', 'in_progress', 'completed', 'no_show')), 0),
    'discounted', count(*) FILTER (WHERE discount_amount > 0 AND status IN ('confirmed', 'checked_in', 'in_progress', 'completed', 'no_show')))
  INTO v_bookings
  FROM cb;

  IF p_from IS NOT NULL AND v_through >= v_from THEN
    v_previous := public.venue_report_window(v_from - v_len, v_from - v_len + (v_through - v_from));
    v_so_far := public.venue_report_window(v_from, v_through);
  END IF;

  WITH days AS (
    SELECT d::date AS d, extract(isodow FROM d)::int - 1 AS dow,
           extract(hour FROM h.open_time)::int AS open_h,
           extract(hour FROM h.close_time)::int + CASE WHEN h.close_time <= h.open_time THEN 24 ELSE 0 END AS close_h
    FROM generate_series(v_from, v_through, interval '1 day') d
    JOIN public.operating_hours h ON h.day_of_week = trim(to_char(d, 'Day')) AND h.is_open
    WHERE h.open_time IS NOT NULL AND h.close_time IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.venue_closures c WHERE c.closed_on = d::date)
  ), booked AS (
    SELECT k.court_id, k.business_date, k.s, k.e,
           greatest(0, extract(epoch FROM (least(k.e, make_interval(hours => k.close_h)) - greatest(k.s, make_interval(hours => k.open_h)))) / 3600) AS hours
    FROM (SELECT b.court_id, b.business_date, d.open_h, d.close_h,
                 b.start_time - time '00:00' + make_interval(days => b.booking_date - b.business_date) AS s,
                 CASE WHEN b.end_time = '00:00' THEN interval '24 hours' ELSE b.end_time - time '00:00' END + make_interval(days => b.booking_date - b.business_date) AS e
          FROM public.bookings b JOIN days d ON d.d = b.business_date
          WHERE b.court_id = ANY (v_court_ids) AND b.status NOT IN ('cancelled', 'pending') AND b.business_date BETWEEN v_from AND v_through) k
  ), blocked AS (
    -- 4. Blocked hours can't be sold, so they leave the open hours (clipped to opening hours like bookings)
    SELECT k.court_id, k.business_date, k.s, k.e,
           greatest(0, extract(epoch FROM (least(k.e, make_interval(hours => k.close_h)) - greatest(k.s, make_interval(hours => k.open_h)))) / 3600) AS hours
    FROM (SELECT cb.court_id, x.bd AS business_date, d.open_h, d.close_h,
                 cb.start_time - time '00:00' + make_interval(days => cb.block_date - x.bd) AS s,
                 cb.end_time - time '00:00' + make_interval(days => cb.block_date - x.bd) AS e
          FROM public.court_blocks cb
          CROSS JOIN LATERAL (SELECT public.business_date(cb.block_date, cb.start_time) AS bd) x
          JOIN days d ON d.d = x.bd
          WHERE cb.court_id = ANY (v_court_ids)) k
  ), per_court AS (
    SELECT coalesce(sum(close_h - open_h), 0) AS open_h FROM days
  ), slots AS (
    SELECT dow, hr, count(*) * v_courts AS available
    FROM days, generate_series(open_h, close_h - 1) hr
    GROUP BY dow, hr
  ), used AS (
    SELECT extract(isodow FROM k.business_date)::int - 1 AS dow, hr,
           sum(extract(epoch FROM (least(k.e, make_interval(hours => hr + 1)) - greatest(k.s, make_interval(hours => hr)))) / 3600) AS hours
    FROM booked k JOIN generate_series(0, 35) hr ON k.s < make_interval(hours => hr + 1) AND k.e > make_interval(hours => hr)
    GROUP BY 1, 2
  ), lost AS (
    SELECT extract(isodow FROM k.business_date)::int - 1 AS dow, hr,
           sum(extract(epoch FROM (least(k.e, make_interval(hours => hr + 1)) - greatest(k.s, make_interval(hours => hr)))) / 3600) AS hours
    FROM blocked k JOIN generate_series(0, 35) hr ON k.s < make_interval(hours => hr + 1) AND k.e > make_interval(hours => hr)
    GROUP BY 1, 2
  ), totals AS (
    SELECT pc.open_h * v_courts - coalesce((SELECT sum(hours) FROM blocked), 0) AS open_hours,
           coalesce((SELECT sum(hours) FROM booked), 0) AS booked_hours
    FROM per_court pc
  )
  SELECT
    jsonb_build_object(
      'pct', CASE WHEN tt.open_hours <= 0 THEN NULL ELSE round(100 * tt.booked_hours / tt.open_hours) END,
      'booked_hours', round(tt.booked_hours, 1),
      'open_hours', round(tt.open_hours, 1)),
    coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name,
        'pct', CASE WHEN NOT (c.id = ANY (v_court_ids)) THEN NULL
               ELSE (SELECT CASE WHEN o <= 0 THEN NULL ELSE round(100 * coalesce((SELECT sum(hours) FROM booked k WHERE k.court_id = c.id), 0) / o) END
                     FROM (SELECT pc.open_h - coalesce((SELECT sum(hours) FROM blocked k WHERE k.court_id = c.id), 0) AS o) z) END)
      ORDER BY c.name) FROM public.courts c), '[]'::jsonb),
    coalesce((SELECT jsonb_agg(jsonb_build_object('dow', sl.dow, 'hour', sl.hr,
                 'pct', CASE WHEN sl.available - coalesce(l.hours, 0) <= 0 THEN 0
                             ELSE least(100, round(100 * coalesce(u.hours, 0) / (sl.available - coalesce(l.hours, 0)))) END)
                               ORDER BY sl.dow, sl.hr)
              FROM slots sl LEFT JOIN used u ON u.dow = sl.dow AND u.hr = sl.hr LEFT JOIN lost l ON l.dow = sl.dow AND l.hr = sl.hr), '[]'::jsonb)
  INTO v_occupancy, v_court_rows, v_heatmap
  FROM per_court pc, totals tt;

  WITH buckets AS (
    SELECT CASE WHEN v_bucket = 'day' THEN to_char(g, 'YYYY-MM-DD') ELSE to_char(g, 'YYYY-MM') END AS key
    FROM generate_series(CASE WHEN v_bucket = 'day' THEN v_from ELSE date_trunc('month', v_from)::date END,
                         v_to, CASE WHEN v_bucket = 'day' THEN interval '1 day' ELSE interval '1 month' END) g
  ), flows AS (
    SELECT public.business_day_of(paid_at) AS d, amount AS gross, 0::numeric AS back, payment_method
    FROM public.payments WHERE status IN ('paid', 'refunded') AND paid_at IS NOT NULL
    UNION ALL
    SELECT public.business_day_of(processed_at), 0, amount, NULL
    FROM public.refund_requests WHERE status IN ('succeeded', 'cash_refunded') AND processed_at IS NOT NULL
  ), money AS (
    SELECT CASE WHEN v_bucket = 'day' THEN to_char(d, 'YYYY-MM-DD') ELSE to_char(d, 'YYYY-MM') END AS key,
           sum(gross) - sum(back) AS net,
           sum(gross) FILTER (WHERE payment_method = 'cash') AS cash,
           sum(gross) FILTER (WHERE payment_method = 'gcash') AS gcash,
           sum(gross) FILTER (WHERE gross > 0 AND coalesce(payment_method, '') NOT IN ('cash', 'gcash')) AS card,
           sum(back) AS refunded
    FROM flows
    WHERE d BETWEEN v_from AND v_to
    GROUP BY 1
  ), books AS (
    SELECT CASE WHEN v_bucket = 'day' THEN to_char(business_date, 'YYYY-MM-DD') ELSE to_char(business_date, 'YYYY-MM') END AS key,
           count(*) AS bookings, sum(extract(epoch FROM (end_time - start_time)) / 3600) AS hours
    FROM public.bookings
    WHERE court_id IS NOT NULL AND open_play_session_id IS NULL AND business_date BETWEEN v_from AND v_to
      AND status IN ('confirmed', 'checked_in', 'in_progress', 'completed', 'no_show')
    GROUP BY 1
  )
  SELECT jsonb_agg(jsonb_build_object(
      'key', bk.key, 'net', coalesce(m.net, 0), 'cash', coalesce(m.cash, 0), 'gcash', coalesce(m.gcash, 0),
      'card', coalesce(m.card, 0), 'refunded', coalesce(m.refunded, 0),
      'bookings', coalesce(k.bookings, 0), 'court_hours', round(coalesce(k.hours, 0), 1)) ORDER BY bk.key)
  INTO v_series
  FROM buckets bk LEFT JOIN money m ON m.key = bk.key LEFT JOIN books k ON k.key = bk.key;

  WITH tagged AS (
    SELECT b.*, coalesce('u:' || b.user_id, 'c:' || b.customer_id, 'n:' || lower(b.customer_name)) AS who,
           coalesce(pr.full_name, cu.full_name, b.customer_name) AS who_name
    FROM public.bookings b
    LEFT JOIN public.profiles pr ON pr.id = b.user_id
    LEFT JOIN public.customers cu ON cu.id = b.customer_id
  ), visits AS (
    SELECT who, count(*) AS visits, sum(extract(epoch FROM (end_time - start_time)) / 3600) AS hours,
           max(business_date) FILTER (WHERE business_date <= v_today) AS last_visit
    FROM tagged
    WHERE court_id IS NOT NULL AND open_play_session_id IS NULL AND business_date BETWEEN v_from AND v_to
      AND status IN ('confirmed', 'checked_in', 'in_progress', 'completed', 'no_show')
    GROUP BY who
  ), spent AS (
    SELECT t.who, sum(p.amount) AS spent
    FROM public.payments p JOIN tagged t ON t.id = p.booking_id
    WHERE p.status = 'paid' AND public.business_day_of(p.paid_at) BETWEEN v_from AND v_to
    GROUP BY t.who
  ), ranked AS (
    SELECT coalesce(v.who, s.who) AS who, coalesce(v.visits, 0) AS visits, coalesce(v.hours, 0) AS hours,
           coalesce(s.spent, 0) AS spent, v.last_visit,
           n.name
    FROM visits v FULL JOIN spent s ON s.who = v.who
    JOIN (SELECT who, max(who_name) AS name FROM tagged GROUP BY who) n ON n.who = coalesce(v.who, s.who)
    ORDER BY spent DESC, visits DESC, name
    LIMIT 5
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'name', r.name,
      'visits', r.visits, 'hours', round(r.hours, 1), 'spent', r.spent, 'last_visit', r.last_visit)
    ORDER BY r.spent DESC, r.visits DESC, r.name), '[]'::jsonb)
  INTO v_top
  FROM ranked r;

  -- 7. Open play sessions held so far in the period: spots sold against spots offered
  WITH s AS (
    SELECT os.id, os.capacity,
           coalesce((SELECT sum(b.open_play_spots) FROM public.bookings b
                     WHERE b.open_play_session_id = os.id AND b.court_id IS NULL
                       AND b.status IN ('confirmed', 'checked_in', 'in_progress', 'completed')), 0) AS sold
    FROM public.open_play_sessions os
    WHERE os.status <> 'cancelled' AND public.business_date(os.session_date, os.start_time) BETWEEN v_from AND v_through
  )
  SELECT jsonb_build_object('sessions', count(*), 'spots_sold', coalesce(sum(sold), 0), 'capacity', coalesce(sum(capacity), 0),
                            'pct', CASE WHEN coalesce(sum(capacity), 0) = 0 THEN NULL ELSE round(100 * sum(sold) / sum(capacity)) END)
  INTO v_open_play FROM s;

  -- 8. Money not settled yet for bookings in the period
  SELECT jsonb_build_object(
    'to_collect', coalesce(sum(p.amount) FILTER (WHERE p.status = 'pending' AND b.status IN ('confirmed', 'checked_in', 'completed')), 0),
    'refund_owed', coalesce(sum(p.amount) FILTER (WHERE p.status = 'paid' AND b.status = 'cancelled'
                                                  AND coalesce(b.cancel_reason, '') <> 'payment_kept'), 0))
  INTO v_outstanding
  FROM public.payments p JOIN public.bookings b ON b.id = p.booking_id
  WHERE b.business_date BETWEEN v_from AND v_to;

  RETURN jsonb_build_object(
    'period', jsonb_build_object('from', v_from, 'to', v_to, 'through', v_through, 'bucket', v_bucket),
    'money', v_money, 'bookings', v_bookings, 'previous', v_previous, 'so_far', v_so_far, 'occupancy', v_occupancy,
    'courts', v_court_rows, 'heatmap', v_heatmap, 'series', coalesce(v_series, '[]'::jsonb), 'top_customers', v_top,
    'open_play_sessions', v_open_play, 'outstanding', v_outstanding);
END;
$function$;

COMMIT;
