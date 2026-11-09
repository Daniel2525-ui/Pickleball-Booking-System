-- Rollback for *_revoke_trigger_execute.sql
GRANT EXECUTE ON FUNCTION public.reject_blocked_court_booking() TO PUBLIC;
