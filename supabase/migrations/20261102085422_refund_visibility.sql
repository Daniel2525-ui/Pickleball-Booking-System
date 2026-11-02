-- Refund visibility: staff can read refund progress (Refund Owed shows a card refund that is pending at
-- Stripe, needs review, or failed), and players can read only the state of refunds on their own bookings.
-- Writes stay in the existing SECURITY DEFINER refund functions; nothing here can change the ledger.

BEGIN;

DROP POLICY IF EXISTS refund_requests_admin_read ON public.refund_requests;
CREATE POLICY refund_requests_admin_read ON public.refund_requests
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- Latest refund request per booking, for the signed-in player's own bookings only (no amounts, ids or errors)
CREATE OR REPLACE FUNCTION public.get_my_refund_states(p_booking_ids uuid[])
RETURNS TABLE (booking_id uuid, status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT DISTINCT ON (r.booking_id) r.booking_id, r.status
  FROM public.refund_requests r
  JOIN public.bookings b ON b.id = r.booking_id
  WHERE r.booking_id = ANY (p_booking_ids) AND b.user_id = auth.uid()
  ORDER BY r.booking_id, r.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_my_refund_states(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_refund_states(uuid[]) TO authenticated;

COMMIT;
