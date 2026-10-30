-- ==============================================================================
-- Migration: gcash_manual_payment
-- Depends on: multi_court_basket (hold_court_basket), booking_cancel_reason (bookings_cancel_reason_check),
--   customer_cancel_pending_only (bookings_update_policy).
-- Description: customers pay by GCash outside the app and upload proof. "Awaiting verification" is a
--   pending booking with hold_expires_at = 'infinity': the existing expiry sweeps, cron and slot checks
--   already key on hold_expires_at, so no existing function changes. Staff then confirm or reject.
--   1. booking_settings holds the club's GCash details; payments holds the proof and its timestamp.
--   2. cancel_reason may be 'gcash_rejected'.
--   3. hold_gcash_basket = hold_court_basket + payment_method 'gcash'.
--   4. submit_gcash_proof records the reference and proof path and makes the hold permanent.
--   5. approve_gcash_basket / reject_gcash_basket let staff confirm or cancel a submitted basket.
--   6. Customers can no longer cancel a submitted booking or edit its payment directly (staff decide).
--   Idempotent: safe to re-run. Rollback: supabase/rollback_gcash_manual_payment.sql.
-- ==============================================================================

BEGIN;

ALTER TABLE public.booking_settings
  ADD COLUMN IF NOT EXISTS gcash_account_name text,
  ADD COLUMN IF NOT EXISTS gcash_number text,
  ADD COLUMN IF NOT EXISTS gcash_qr_url text;
ALTER TABLE public.booking_settings DROP CONSTRAINT IF EXISTS booking_settings_gcash_check;
ALTER TABLE public.booking_settings ADD CONSTRAINT booking_settings_gcash_check CHECK (
  (gcash_account_name IS NULL AND gcash_number IS NULL)
  OR (gcash_account_name IS NOT NULL AND gcash_number IS NOT NULL
      AND char_length(gcash_account_name) BETWEEN 1 AND 100 AND gcash_number ~ '^09[0-9]{9}$')
);

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS gcash_proof_path text,
  ADD COLUMN IF NOT EXISTS gcash_submitted_at timestamptz;

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_cancel_reason_check;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_cancel_reason_check CHECK (
  cancel_reason IS NULL
  OR cancel_reason IN ('expired', 'customer', 'admin', 'checkout_failed', 'slot_conflict', 'court_unavailable', 'start_passed', 'gcash_rejected')
);

DROP POLICY IF EXISTS bookings_update_policy ON public.bookings;
CREATE POLICY bookings_update_policy ON public.bookings
  FOR UPDATE
  USING (
    coalesce(auth.role(), '') = 'service_role'
    OR (current_user = 'postgres' AND auth.role() IS NULL)
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    OR (user_id = auth.uid() AND status = 'pending' AND hold_expires_at IS DISTINCT FROM 'infinity')
  )
  WITH CHECK (
    coalesce(auth.role(), '') = 'service_role'
    OR (current_user = 'postgres' AND auth.role() IS NULL)
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    OR (user_id = auth.uid() AND status = 'cancelled' AND cancel_reason = 'customer')
  );

DROP POLICY IF EXISTS payments_update_policy ON public.payments;
CREATE POLICY payments_update_policy ON public.payments
  FOR UPDATE
  USING (
    coalesce(auth.role(), '') = 'service_role'
    OR (current_user = 'postgres' AND auth.role() IS NULL)
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    OR (EXISTS (SELECT 1 FROM public.bookings b WHERE b.id = booking_id AND b.user_id = auth.uid()) AND status = 'pending' AND gcash_submitted_at IS NULL)
  )
  WITH CHECK (
    coalesce(auth.role(), '') = 'service_role'
    OR (current_user = 'postgres' AND auth.role() IS NULL)
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    OR (EXISTS (SELECT 1 FROM public.bookings b WHERE b.id = booking_id AND b.user_id = auth.uid()) AND status = 'failed')
  );

CREATE OR REPLACE FUNCTION public.hold_gcash_basket(p_booking_date date, p_lines jsonb, p_hold_expires_at timestamptz DEFAULT NULL) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v jsonb;
BEGIN
  IF (SELECT gcash_number FROM public.booking_settings LIMIT 1) IS NULL THEN
    RAISE EXCEPTION 'GCASH_NOT_CONFIGURED: GCash payment is not set up' USING ERRCODE = 'P0001';
  END IF;

  v := public.hold_court_basket(p_booking_date, p_lines, p_hold_expires_at);
  UPDATE public.payments SET payment_method = 'gcash'
  WHERE id IN (SELECT (i->>'payment_id')::uuid FROM jsonb_array_elements(v->'items') i);
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_gcash_proof(p_basket_id uuid, p_reference text, p_proof_path text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_ref text := regexp_replace(coalesce(p_reference, ''), '[\s-]', '', 'g');
  v_ids uuid[];
  v_submitted boolean;
  v_expired boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required' USING ERRCODE = '42501';
  END IF;
  IF v_ref !~ '^[A-Za-z0-9]{6,20}$' THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Reference must be 6-20 letters or digits' USING ERRCODE = '22000';
  END IF;
  IF p_proof_path IS NULL OR left(p_proof_path, length(auth.uid()::text) + 1) != auth.uid()::text || '/'
     OR p_proof_path LIKE '%..%' OR length(p_proof_path) > 300 THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Proof must be in your own folder' USING ERRCODE = '22000';
  END IF;

  SELECT array_agg(id), bool_or(hold_expires_at = 'infinity'),
         bool_or(coalesce(hold_expires_at, created_at + interval '35 minutes') <= clock_timestamp())
  INTO v_ids, v_submitted, v_expired
  FROM (
    SELECT id, hold_expires_at, created_at FROM public.bookings
    WHERE basket_id = p_basket_id AND user_id = auth.uid() AND status = 'pending'
    ORDER BY court_id FOR UPDATE
  ) b;
  IF v_ids IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: No pending bookings in this basket' USING ERRCODE = 'P0001';
  END IF;
  IF v_submitted THEN
    RAISE EXCEPTION 'ALREADY_SUBMITTED: Proof was already sent' USING ERRCODE = 'P0001';
  END IF;
  IF v_expired THEN
    RAISE EXCEPTION 'HOLD_EXPIRED: The hold has expired' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM public.payments
      WHERE booking_id = ANY (v_ids) AND payment_method = 'gcash' AND status = 'pending') != cardinality(v_ids) THEN
    RAISE EXCEPTION 'INVALID_STATUS: Payment is not a pending GCash payment' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.payments
  SET payment_reference = v_ref, gcash_proof_path = p_proof_path, gcash_submitted_at = now()
  WHERE booking_id = ANY (v_ids);
  UPDATE public.bookings SET hold_expires_at = 'infinity' WHERE id = ANY (v_ids);

  RETURN jsonb_build_object('basket_id', p_basket_id, 'submitted', cardinality(v_ids));
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_gcash_basket(p_basket_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_ids uuid[];
  v_amount numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'FORBIDDEN: Admin privileges required' USING ERRCODE = '42501';
  END IF;

  -- Only submitted rows: a court cancelled meanwhile is left alone
  SELECT array_agg(id), sum(total_amount) INTO v_ids, v_amount
  FROM (
    SELECT b.id, b.total_amount FROM public.bookings b
    WHERE b.basket_id = p_basket_id AND b.status = 'pending' AND b.hold_expires_at = 'infinity'
      AND EXISTS (SELECT 1 FROM public.payments p WHERE p.booking_id = b.id AND p.payment_method = 'gcash'
                  AND p.status = 'pending' AND p.gcash_submitted_at IS NOT NULL)
    ORDER BY b.court_id FOR UPDATE
  ) b;
  IF v_ids IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: No submitted GCash bookings in this basket' USING ERRCODE = 'P0001';
  END IF;
  PERFORM 1 FROM public.payments WHERE booking_id = ANY (v_ids) ORDER BY booking_id FOR UPDATE;

  -- Deliberately no start-time or hold-expiry check: the customer already paid.
  UPDATE public.payments SET status = 'paid', paid_at = now() WHERE booking_id = ANY (v_ids);
  UPDATE public.bookings SET status = 'confirmed', hold_expires_at = NULL, updated_at = now() WHERE id = ANY (v_ids);

  RETURN jsonb_build_object('basket_id', p_basket_id, 'approved', cardinality(v_ids), 'amount', v_amount);
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_gcash_basket(p_basket_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_ids uuid[];
  v_amount numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'FORBIDDEN: Admin privileges required' USING ERRCODE = '42501';
  END IF;

  -- Only submitted rows: a court cancelled meanwhile is left alone
  SELECT array_agg(id), sum(total_amount) INTO v_ids, v_amount
  FROM (
    SELECT b.id, b.total_amount FROM public.bookings b
    WHERE b.basket_id = p_basket_id AND b.status = 'pending' AND b.hold_expires_at = 'infinity'
      AND EXISTS (SELECT 1 FROM public.payments p WHERE p.booking_id = b.id AND p.payment_method = 'gcash'
                  AND p.status = 'pending' AND p.gcash_submitted_at IS NOT NULL)
    ORDER BY b.court_id FOR UPDATE
  ) b;
  IF v_ids IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: No submitted GCash bookings in this basket' USING ERRCODE = 'P0001';
  END IF;
  PERFORM 1 FROM public.payments WHERE booking_id = ANY (v_ids) ORDER BY booking_id FOR UPDATE;

  UPDATE public.payments SET status = 'failed' WHERE booking_id = ANY (v_ids);
  UPDATE public.bookings SET status = 'cancelled', cancel_reason = 'gcash_rejected', updated_at = now() WHERE id = ANY (v_ids);

  RETURN jsonb_build_object('basket_id', p_basket_id, 'rejected', cardinality(v_ids));
END;
$$;

REVOKE ALL ON FUNCTION public.hold_gcash_basket(date, jsonb, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hold_gcash_basket(date, jsonb, timestamptz) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.submit_gcash_proof(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_gcash_proof(uuid, text, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.approve_gcash_basket(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_gcash_basket(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.reject_gcash_basket(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_gcash_basket(uuid) TO authenticated, service_role;

COMMIT;
