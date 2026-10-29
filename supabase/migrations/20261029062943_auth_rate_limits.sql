-- ==============================================================================
-- Migration: auth_rate_limits
-- Description: fixed-window counters for sign-in, sign-up and password-reset requests, shared by every
--   app instance. Only the service role (the Next.js auth routes) can read or write them.
--   check_rate_limit(key, limit, window_seconds, increment):
--     increment = true  -> counts this attempt; allowed while the count is <= limit
--     increment = false -> only reads (e.g. failed logins so far); allowed while the count is < limit
--   A window restarts once it is older than window_seconds. Old rows are deleted by the cleanup cron route.
--   Idempotent: safe to re-run.
-- ==============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.auth_rate_limits (
  key text PRIMARY KEY CHECK (length(key) <= 300),
  window_start timestamptz NOT NULL,
  count integer NOT NULL CHECK (count >= 0)
);

ALTER TABLE public.auth_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_rate_limits FORCE ROW LEVEL SECURITY;
-- No policies: anon/authenticated have no access; the service role bypasses RLS
REVOKE ALL ON public.auth_rate_limits FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.auth_rate_limits TO service_role;

CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_window_start ON public.auth_rate_limits (window_start);

CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer,
  p_increment boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_window interval := make_interval(secs => p_window_seconds);
  v_row public.auth_rate_limits;
  v_allowed boolean;
BEGIN
  IF coalesce(auth.role(), '') != 'service_role' AND (session_user != 'postgres' OR auth.role() IS NOT NULL) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Service role required' USING ERRCODE = '42501';
  END IF;
  IF p_key IS NULL OR trim(p_key) = '' OR p_limit < 1 OR p_window_seconds < 1 THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: key, limit and window are required' USING ERRCODE = '22000';
  END IF;

  IF p_increment THEN
    -- Single statement, so concurrent requests for the same key cannot both slip under the limit
    INSERT INTO public.auth_rate_limits AS r (key, window_start, count)
    VALUES (p_key, v_now, 1)
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN r.window_start <= v_now - v_window THEN 1 ELSE r.count + 1 END,
      window_start = CASE WHEN r.window_start <= v_now - v_window THEN v_now ELSE r.window_start END
    RETURNING * INTO v_row;
    v_allowed := v_row.count <= p_limit;
  ELSE
    SELECT * INTO v_row FROM public.auth_rate_limits WHERE key = p_key;
    IF NOT FOUND OR v_row.window_start <= v_now - v_window THEN
      RETURN jsonb_build_object('allowed', true, 'count', 0, 'retry_after_seconds', 0);
    END IF;
    v_allowed := v_row.count < p_limit;
  END IF;

  RETURN jsonb_build_object(
    'allowed', v_allowed,
    'count', v_row.count,
    'retry_after_seconds', CASE WHEN v_allowed THEN 0
      ELSE greatest(1, ceil(extract(epoch FROM (v_row.window_start + v_window - v_now))))::integer END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.check_rate_limit(text, integer, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, integer, integer, boolean) TO service_role;

COMMIT;
