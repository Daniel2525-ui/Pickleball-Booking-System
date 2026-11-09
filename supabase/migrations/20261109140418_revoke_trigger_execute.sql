-- reject_blocked_court_booking() is a trigger function (court_blocks migration) and was never meant to be
-- callable through the API. PostgreSQL checks EXECUTE when a trigger is created, not when it fires,
-- so the bookings trigger keeps working. Rollback: supabase/rollback_revoke_trigger_execute.sql
REVOKE EXECUTE ON FUNCTION public.reject_blocked_court_booking() FROM PUBLIC, anon, authenticated;
