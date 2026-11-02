-- Rollback for 20261103000002_refund_visibility.sql

BEGIN;

DROP FUNCTION IF EXISTS public.get_my_refund_states(uuid[]);
DROP POLICY IF EXISTS refund_requests_admin_read ON public.refund_requests;

COMMIT;
