-- Run once against the LOCAL Supabase stack (never production): it was loaded from an old schema dump and
-- grants more than production does. This removes exactly the extra grants found on 2026-11-05 by comparing
-- both databases, so e2e tests run under production's permissions. Safe to run again.
BEGIN;
REVOKE DELETE ON public.bookings FROM anon;
REVOKE INSERT ON public.bookings FROM anon;
REVOKE TRUNCATE ON public.bookings FROM anon;
REVOKE UPDATE ON public.bookings FROM anon;
REVOKE TRUNCATE ON public.bookings FROM authenticated;
REVOKE DELETE ON public.courts FROM anon;
REVOKE INSERT ON public.courts FROM anon;
REVOKE TRUNCATE ON public.courts FROM anon;
REVOKE UPDATE ON public.courts FROM anon;
REVOKE TRUNCATE ON public.courts FROM authenticated;
REVOKE DELETE ON public.customers FROM anon;
REVOKE INSERT ON public.customers FROM anon;
REVOKE TRUNCATE ON public.customers FROM anon;
REVOKE UPDATE ON public.customers FROM anon;
REVOKE TRUNCATE ON public.customers FROM authenticated;
REVOKE DELETE ON public.operating_hours FROM anon;
REVOKE INSERT ON public.operating_hours FROM anon;
REVOKE TRUNCATE ON public.operating_hours FROM anon;
REVOKE UPDATE ON public.operating_hours FROM anon;
REVOKE TRUNCATE ON public.operating_hours FROM authenticated;
REVOKE DELETE ON public.payments FROM anon;
REVOKE INSERT ON public.payments FROM anon;
REVOKE TRUNCATE ON public.payments FROM anon;
REVOKE UPDATE ON public.payments FROM anon;
REVOKE TRUNCATE ON public.payments FROM authenticated;
REVOKE DELETE ON public.profiles FROM anon;
REVOKE INSERT ON public.profiles FROM anon;
REVOKE TRUNCATE ON public.profiles FROM anon;
REVOKE UPDATE ON public.profiles FROM anon;
REVOKE DELETE ON public.profiles FROM authenticated;
REVOKE INSERT ON public.profiles FROM authenticated;
REVOKE TRUNCATE ON public.profiles FROM authenticated;
REVOKE UPDATE ON public.profiles FROM authenticated;
REVOKE DELETE ON public.refund_requests FROM anon;
REVOKE INSERT ON public.refund_requests FROM anon;
REVOKE TRUNCATE ON public.refund_requests FROM anon;
REVOKE UPDATE ON public.refund_requests FROM anon;
REVOKE TRUNCATE ON public.refund_requests FROM authenticated;
-- Profiles: players edit only their own name and phone (as launch_hardening grants on production)
REVOKE UPDATE ON public.profiles FROM anon, authenticated;
GRANT UPDATE (full_name, phone) ON public.profiles TO authenticated;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS fn, g.role FROM pg_proc p JOIN (VALUES
    ('cancel_expired_booking', 'anon'),
    ('cancel_expired_booking', 'authenticated'),
    ('claim_pending_refund_request', 'anon'),
    ('claim_pending_refund_request', 'authenticated'),
    ('confirm_manual_cash_refund', 'anon'),
    ('create_walk_in_booking', 'anon'),
    ('handle_new_user', 'anon'),
    ('handle_new_user', 'authenticated'),
    ('hold_release_after', 'anon'),
    ('hold_release_after', 'authenticated'),
    ('is_admin', 'anon'),
    ('release_expired_court_holds', 'anon'),
    ('release_expired_court_holds', 'authenticated'),
    ('request_manual_cash_refund', 'anon'),
    ('reserve_payment_refund', 'anon'),
    ('settle_counter_payment', 'anon'),
    ('settle_stripe_refund', 'anon'),
    ('settle_stripe_refund', 'authenticated')
  ) AS g(name, role) ON p.proname = g.name WHERE p.pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, %I', r.fn, r.role);
  END LOOP;
END $$;
COMMIT;
