-- Rollback for 20261112174753_guest_followups: back to 20261112173834 (codes held through the grace period, late
-- payments over a code's limit confirmed, one customer row per guest profile).
-- Bookings already cancelled with reason 'discount_used_up' are relabelled 'slot_conflict' (also a refunded lapsed hold).
BEGIN;

CREATE OR REPLACE FUNCTION public.discount_code_uses(p_code_id uuid) RETURNS integer LANGUAGE sql STABLE SET search_path TO '' AS $$
  SELECT count(DISTINCT coalesce(b.basket_id, b.id))::integer
  FROM public.bookings b
  WHERE b.discount_code_id = p_code_id
    AND (b.status IN ('confirmed', 'checked_in', 'in_progress', 'completed', 'no_show')
         OR (b.status = 'pending' AND public.hold_release_after(b.hold_expires_at, b.created_at) > clock_timestamp()));
$$;

DO $mig$
DECLARE
  f constant text := 'public.reconcile_booking_payment(uuid,uuid,text,text,numeric,text)';
  d text := pg_get_functiondef(f::regprocedure);
  n text;
BEGIN
  n := replace(d, $q$  -- Branch 5b: The hold lapsed and its discount code ran out meanwhile (another checkout took the freed use):
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

$q$, '');
  n := replace(n, $q$DECLARE
  v_code_id uuid;
  v_code_basket uuid;
  v_code_hold timestamptz;
  v_code_max integer;
$q$, E'DECLARE\n');
  IF n = d OR n LIKE '%discount_used_up%' THEN RAISE EXCEPTION 'rollback_guest_followups: branch not found in %', f; END IF;
  EXECUTE n;
END
$mig$;

UPDATE public.bookings SET cancel_reason = 'slot_conflict' WHERE cancel_reason = 'discount_used_up';
ALTER TABLE public.bookings DROP CONSTRAINT bookings_cancel_reason_check;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_cancel_reason_check
  CHECK (cancel_reason IS NULL OR cancel_reason IN ('expired', 'customer', 'admin', 'checkout_failed', 'slot_conflict', 'court_unavailable', 'start_passed', 'gcash_rejected', 'payment_kept'));

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
