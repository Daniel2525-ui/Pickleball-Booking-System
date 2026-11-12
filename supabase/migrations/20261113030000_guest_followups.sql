-- Follow-ups to guest checkout and discount codes (20261113020000):
--   * a code's use is held only while the checkout's 15-minute hold is live (it was 35 minutes, with the grace period)
--   * a late payment whose code ran out meanwhile is refunded instead of taking the code past its limit
--   * the admin customer list shows one row per guest email (one guest on several devices)
-- Rollback: supabase/rollback_guest_followups.sql
BEGIN;

-- 1. Uses: a pending checkout counts while its hold is live, not through the grace period
CREATE OR REPLACE FUNCTION public.discount_code_uses(p_code_id uuid) RETURNS integer LANGUAGE sql STABLE SET search_path TO '' AS $$
  SELECT count(DISTINCT coalesce(b.basket_id, b.id))::integer
  FROM public.bookings b
  WHERE b.discount_code_id = p_code_id
    AND (b.status IN ('confirmed', 'checked_in', 'in_progress', 'completed', 'no_show')
         OR (b.status = 'pending' AND coalesce(b.hold_expires_at, b.created_at + interval '35 minutes') > clock_timestamp()));
$$;

-- 2. A late payment over the code's limit is refunded
ALTER TABLE public.bookings DROP CONSTRAINT bookings_cancel_reason_check;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_cancel_reason_check
  CHECK (cancel_reason IS NULL OR cancel_reason IN ('expired', 'customer', 'admin', 'checkout_failed', 'slot_conflict', 'court_unavailable', 'start_passed', 'gcash_rejected', 'payment_kept', 'discount_used_up'));

DO $mig$
DECLARE
  f constant text := 'public.reconcile_booking_payment(uuid,uuid,text,text,numeric,text)';
  d text := pg_get_functiondef(f::regprocedure);
  n text;
BEGIN
  n := replace(d, $q$  -- Branch 6: Eligible, Slot Free, Time Future -> Normal Confirmation$q$, $q$  -- Branch 5b: The hold lapsed and its discount code ran out meanwhile (another checkout took the freed use):
  -- refunded, the way a lapsed hold whose court was taken is (Branch 5), so a code never goes over its limit
  SELECT b.discount_code_id, coalesce(b.basket_id, b.id), b.hold_expires_at INTO v_code_id, v_code_basket, v_code_hold
  FROM public.bookings b WHERE b.id = p_booking_id;
  IF v_code_id IS NOT NULL AND v_code_hold IS NOT NULL AND v_code_hold <= clock_timestamp() THEN
    SELECT max_uses INTO v_code_max FROM public.discount_codes WHERE id = v_code_id FOR UPDATE;
    IF v_code_max IS NOT NULL AND (
      SELECT count(DISTINCT coalesce(o.basket_id, o.id)) FROM public.bookings o
      WHERE o.discount_code_id = v_code_id AND coalesce(o.basket_id, o.id) <> v_code_basket
        AND (o.status IN ('confirmed', 'checked_in', 'in_progress', 'completed', 'no_show')
             OR (o.status = 'pending' AND coalesce(o.hold_expires_at, o.created_at + interval '35 minutes') > clock_timestamp()))
    ) >= v_code_max THEN
      UPDATE public.payments
      SET status = 'paid',
          payment_method = 'stripe',
          stripe_session_id = coalesce(p_stripe_session_id, stripe_session_id),
          stripe_payment_id = p_stripe_payment_intent,
          paid_at = v_now
      WHERE id = p_payment_id;

      UPDATE public.bookings
      SET status = 'cancelled',
          cancel_reason = 'discount_used_up',
          hold_expires_at = NULL,
          updated_at = v_now
      WHERE id = p_booking_id;

      v_idempotency_key := 'ref_discount_used_up_' || p_payment_id;
      v_refund_res := public.reserve_payment_refund(
        p_payment_id, p_booking_id, p_amount, p_currency, 'stripe', 'DISCOUNT_USED_UP_REFUND', v_idempotency_key, p_stripe_payment_intent
      );

      RETURN jsonb_build_object(
        'action', 'REFUND_SCHEDULED',
        'reason', 'DISCOUNT_USED_UP',
        'payment_id', p_payment_id,
        'idempotency_key', v_idempotency_key,
        'refund_request_id', v_refund_res->>'refund_request_id'
      );
    END IF;
  END IF;

  -- Branch 6: Eligible, Slot Free, Time Future -> Normal Confirmation$q$);
  n := regexp_replace(n, E'DECLARE\n', $q$DECLARE
  v_code_id uuid;
  v_code_basket uuid;
  v_code_hold timestamptz;
  v_code_max integer;
$q$);
  IF n = d OR n NOT LIKE '%discount_used_up%' OR n NOT LIKE '%v_code_max integer%' THEN
    RAISE EXCEPTION 'guest_followups: confirmation branch not found in %', f;
  END IF;
  EXECUTE n;
END
$mig$;

-- 3. The customer list: one row per guest email
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
  WHERE COALESCE(p.role, ''::text) <> 'admin'::text AND NOT p.is_guest
UNION ALL
 SELECT g.id,
    'registered'::text AS type,
    g.full_name,
    g.email,
    g.phone,
    g.created_at,
    g.bookings_count,
    g.last_visit,
    g.no_shows,
    g.total_spent,
    n.note,
    true AS is_guest
   FROM ( SELECT (array_agg(p.id ORDER BY p.created_at DESC))[1] AS id,
            (array_agg(p.full_name ORDER BY p.created_at DESC))[1] AS full_name,
            lower(p.email) AS email,
            (array_agg(p.phone ORDER BY p.created_at DESC))[1] AS phone,
            min(p.created_at) AS created_at,
            sum(h.bookings_count)::integer AS bookings_count,
            max(h.last_visit) AS last_visit,
            sum(h.no_shows)::integer AS no_shows,
            sum(m.total_spent) AS total_spent
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
          WHERE p.is_guest AND COALESCE(p.role, ''::text) <> 'admin'::text
          GROUP BY (lower(p.email))) g
     LEFT JOIN customer_notes n ON n.person_id = g.id
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
