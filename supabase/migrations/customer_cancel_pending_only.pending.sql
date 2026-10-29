-- ==============================================================================
-- Migration: customer_cancel_pending_only
-- Depends on: 20261031 (bookings_update_policy), app code where /api/bookings/cancel updates via service role.
-- Description: customers could cancel their own CONFIRMED (paid) booking with a direct PostgREST
--   update, skipping the 2-hour cutoff and the automatic refund in /api/bookings/cancel.
--   Customers may now only cancel their own unpaid (pending) holds directly; confirmed bookings
--   must go through the API route, which enforces the cutoff and refunds with the service role.
--   Deploy the app code first, or customers' confirmed cancellations fail until it is live.
-- ==============================================================================

BEGIN;

DROP POLICY IF EXISTS bookings_update_policy ON public.bookings;
CREATE POLICY bookings_update_policy ON public.bookings
  FOR UPDATE
  USING (
    coalesce(auth.role(), '') = 'service_role'
    OR (current_user = 'postgres' AND auth.role() IS NULL)
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    OR (user_id = auth.uid() AND status = 'pending')
  )
  WITH CHECK (
    coalesce(auth.role(), '') = 'service_role'
    OR (current_user = 'postgres' AND auth.role() IS NULL)
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    OR (user_id = auth.uid() AND status = 'cancelled')
  );

COMMIT;
