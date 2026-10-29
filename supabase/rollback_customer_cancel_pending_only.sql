-- Rollback: customer_cancel_pending_only — restores the 20261031 policy (customers may cancel pending or confirmed rows).
BEGIN;

DROP POLICY IF EXISTS bookings_update_policy ON public.bookings;
CREATE POLICY bookings_update_policy ON public.bookings
  FOR UPDATE
  USING (
    coalesce(auth.role(), '') = 'service_role'
    OR (current_user = 'postgres' AND auth.role() IS NULL)
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    OR (user_id = auth.uid() AND status IN ('pending', 'confirmed'))
  )
  WITH CHECK (
    coalesce(auth.role(), '') = 'service_role'
    OR (current_user = 'postgres' AND auth.role() IS NULL)
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    OR (user_id = auth.uid() AND status = 'cancelled')
  );

COMMIT;
