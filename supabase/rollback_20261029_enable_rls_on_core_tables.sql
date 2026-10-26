-- ==============================================================================
-- Rollback Migration: rollback_20261029_enable_rls_on_core_tables.sql
-- Description: Disables Row Level Security (RLS) on core domain tables,
--              restoring the pre-20261029 schema state.
-- ==============================================================================

BEGIN;

DROP POLICY IF EXISTS bookings_select_policy ON public.bookings;
DROP POLICY IF EXISTS bookings_insert_policy ON public.bookings;
DROP POLICY IF EXISTS bookings_update_policy ON public.bookings;
DROP POLICY IF EXISTS bookings_delete_policy ON public.bookings;
ALTER TABLE public.bookings NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.bookings DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payments_select_policy ON public.payments;
DROP POLICY IF EXISTS payments_insert_policy ON public.payments;
DROP POLICY IF EXISTS payments_update_policy ON public.payments;
DROP POLICY IF EXISTS payments_delete_policy ON public.payments;
ALTER TABLE public.payments NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.payments DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS refund_requests_service_role ON public.refund_requests;
ALTER TABLE public.refund_requests NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.refund_requests DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS courts_select_policy ON public.courts;
DROP POLICY IF EXISTS courts_admin_policy ON public.courts;
ALTER TABLE public.courts NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.courts DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS operating_hours_select_policy ON public.operating_hours;
DROP POLICY IF EXISTS operating_hours_admin_policy ON public.operating_hours;
ALTER TABLE public.operating_hours NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.operating_hours DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_select_policy ON public.profiles;
DROP POLICY IF EXISTS profiles_update_policy ON public.profiles;
ALTER TABLE public.profiles NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY;

COMMIT;
