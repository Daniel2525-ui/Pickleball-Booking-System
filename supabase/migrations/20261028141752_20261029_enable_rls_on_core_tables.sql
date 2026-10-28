-- ==============================================================================
-- Migration: 20261029_enable_rls_on_core_tables.sql
-- Description: Enables Row Level Security (RLS) on core domain tables
--              (bookings, payments, refund_requests, courts, operating_hours, profiles)
--              to prevent unauthorized anonymous access via public PostgREST API.
-- ==============================================================================

BEGIN;

-- 0. Standard schema privileges for Supabase PostgREST roles
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

-- 1. Bookings Table RLS
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bookings_select_policy ON public.bookings;
CREATE POLICY bookings_select_policy ON public.bookings
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS bookings_insert_policy ON public.bookings;
CREATE POLICY bookings_insert_policy ON public.bookings
  FOR INSERT
  WITH CHECK (
    coalesce(auth.role(), '') = 'service_role'
    OR (current_user = 'postgres' AND auth.role() IS NULL)
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

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

-- 2. Payments Table RLS
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payments_select_policy ON public.payments;
CREATE POLICY payments_select_policy ON public.payments
  FOR SELECT
  USING (
    coalesce(auth.role(), '') = 'service_role'
    OR (current_user = 'postgres' AND auth.role() IS NULL)
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    OR EXISTS (SELECT 1 FROM public.bookings b WHERE b.id = booking_id AND b.user_id = auth.uid())
  );

DROP POLICY IF EXISTS payments_insert_policy ON public.payments;
CREATE POLICY payments_insert_policy ON public.payments
  FOR INSERT
  WITH CHECK (
    coalesce(auth.role(), '') = 'service_role'
    OR (current_user = 'postgres' AND auth.role() IS NULL)
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

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

-- 3. Refund Requests Table RLS
ALTER TABLE public.refund_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refund_requests FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS refund_requests_service_role ON public.refund_requests;
CREATE POLICY refund_requests_service_role ON public.refund_requests
  FOR ALL
  USING (
    coalesce(auth.role(), '') = 'service_role'
    OR (current_user = 'postgres' AND auth.role() IS NULL)
  );

-- 4. Courts Table RLS
ALTER TABLE public.courts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS courts_select_policy ON public.courts;
CREATE POLICY courts_select_policy ON public.courts
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS courts_admin_policy ON public.courts;
CREATE POLICY courts_admin_policy ON public.courts
  FOR ALL
  USING (
    coalesce(auth.role(), '') = 'service_role'
    OR (current_user = 'postgres' AND auth.role() IS NULL)
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- 5. Operating Hours Table RLS
ALTER TABLE public.operating_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operating_hours FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS operating_hours_select_policy ON public.operating_hours;
CREATE POLICY operating_hours_select_policy ON public.operating_hours
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS operating_hours_admin_policy ON public.operating_hours;
CREATE POLICY operating_hours_admin_policy ON public.operating_hours
  FOR ALL
  USING (
    coalesce(auth.role(), '') = 'service_role'
    OR (current_user = 'postgres' AND auth.role() IS NULL)
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- 6. Profiles Table RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_select_policy ON public.profiles;
CREATE POLICY profiles_select_policy ON public.profiles
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS profiles_update_policy ON public.profiles;
CREATE POLICY profiles_update_policy ON public.profiles
  FOR UPDATE
  USING (
    id = auth.uid()
    OR coalesce(auth.role(), '') = 'service_role'
    OR (current_user = 'postgres' AND auth.role() IS NULL)
  );

COMMIT;
