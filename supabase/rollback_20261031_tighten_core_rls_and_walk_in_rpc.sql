-- ==============================================================================
-- Rollback: rollback_20261031_tighten_core_rls_and_walk_in_rpc.sql
-- Description: Reverts 20261031 migration back to 20261029/20261030 states.
-- ==============================================================================

BEGIN;

-- 1. Revert profiles update policy
DROP POLICY IF EXISTS profiles_update_policy ON public.profiles;
CREATE POLICY profiles_update_policy ON public.profiles
  FOR UPDATE
  USING (
    id = auth.uid()
    OR coalesce(auth.role(), '') = 'service_role'
    OR (current_user = 'postgres' AND auth.role() IS NULL)
  );

-- 2. Revert customers table RLS
DROP POLICY IF EXISTS customers_admin_policy ON public.customers;
DROP POLICY IF EXISTS customers_select_policy ON public.customers;
ALTER TABLE public.customers DISABLE ROW LEVEL SECURITY;

-- 3. Revert bookings policies
DROP POLICY IF EXISTS bookings_update_policy ON public.bookings;
CREATE POLICY bookings_update_policy ON public.bookings
  FOR UPDATE
  USING (
    coalesce(auth.role(), '') = 'service_role'
    OR (current_user = 'postgres' AND auth.role() IS NULL)
    OR user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS bookings_delete_policy ON public.bookings;
CREATE POLICY bookings_delete_policy ON public.bookings
  FOR DELETE
  USING (
    coalesce(auth.role(), '') = 'service_role'
    OR (current_user = 'postgres' AND auth.role() IS NULL)
    OR user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- 4. Revert payments policies
DROP POLICY IF EXISTS payments_update_policy ON public.payments;
CREATE POLICY payments_update_policy ON public.payments
  FOR UPDATE
  USING (
    coalesce(auth.role(), '') = 'service_role'
    OR (current_user = 'postgres' AND auth.role() IS NULL)
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    OR EXISTS (SELECT 1 FROM public.bookings b WHERE b.id = booking_id AND b.user_id = auth.uid())
  );

DROP POLICY IF EXISTS payments_delete_policy ON public.payments;
CREATE POLICY payments_delete_policy ON public.payments
  FOR DELETE
  USING (
    coalesce(auth.role(), '') = 'service_role'
    OR (current_user = 'postgres' AND auth.role() IS NULL)
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    OR EXISTS (SELECT 1 FROM public.bookings b WHERE b.id = booking_id AND b.user_id = auth.uid())
  );

-- 5. Drop 10-param create_walk_in_booking
DROP FUNCTION IF EXISTS public.create_walk_in_booking(uuid, text, date, time, time, numeric, uuid, uuid, text, text);

COMMIT;
