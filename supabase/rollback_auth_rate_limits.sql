-- Rollback: auth_rate_limits — removes the limiter table and function (current counters are discarded).
-- Roll back the app's /api/auth routes first, or they fail open (log an error and allow the request).
BEGIN;
DROP FUNCTION IF EXISTS public.check_rate_limit(text, integer, integer, boolean);
DROP TABLE IF EXISTS public.auth_rate_limits;
COMMIT;
