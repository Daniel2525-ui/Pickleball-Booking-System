-- ==============================================================================
-- Migration: gcash_reject_clears_hold
-- Depends on: gcash_manual_payment.
-- Description: a rejected GCash basket no longer keeps hold_expires_at = 'infinity' (the "awaiting
--   verification" marker), the same way approve clears it. Also drops reject's unused amount sum.
--   Idempotent: safe to re-run. Rollback: supabase/rollback_gcash_reject_clears_hold.sql.
-- ==============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.reject_gcash_basket(p_basket_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_ids uuid[];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'FORBIDDEN: Admin privileges required' USING ERRCODE = '42501';
  END IF;

  -- Only submitted rows: a court cancelled meanwhile is left alone
  SELECT array_agg(id) INTO v_ids
  FROM (
    SELECT b.id FROM public.bookings b
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
  UPDATE public.bookings SET status = 'cancelled', cancel_reason = 'gcash_rejected', hold_expires_at = NULL, updated_at = now()
  WHERE id = ANY (v_ids);

  RETURN jsonb_build_object('basket_id', p_basket_id, 'rejected', cardinality(v_ids));
END;
$$;

REVOKE ALL ON FUNCTION public.reject_gcash_basket(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_gcash_basket(uuid) TO authenticated, service_role;

-- Rows rejected before this migration
UPDATE public.bookings SET hold_expires_at = NULL WHERE status = 'cancelled' AND hold_expires_at = 'infinity';

COMMIT;
