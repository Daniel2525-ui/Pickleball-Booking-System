-- Rollout step A: the additive part of 20261101 (section 4, verbatim). The read-restricting
-- policies in 20261101 are applied after the new application code is deployed.
BEGIN;
-- 4. Public slot availability RPC (minimal exposure, statement_timestamp() evaluation)
CREATE OR REPLACE FUNCTION public.get_public_slot_availability(p_booking_date date)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  court_id uuid,
  start_time time,
  end_time time,
  status text,
  hold_expires_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT 
    CASE WHEN b.user_id = auth.uid() THEN b.id ELSE NULL END AS id,
    CASE WHEN b.user_id = auth.uid() THEN b.user_id ELSE NULL END AS user_id,
    b.court_id,
    b.start_time,
    b.end_time,
    b.status,
    CASE WHEN b.user_id = auth.uid() THEN b.hold_expires_at ELSE NULL END AS hold_expires_at
  FROM public.bookings b
  WHERE b.booking_date = p_booking_date
    AND (
      b.status IN ('confirmed', 'completed', 'checked_in', 'in_progress')
      OR (
        b.status = 'pending' 
        AND coalesce(b.hold_expires_at, b.created_at + interval '35 minutes') > statement_timestamp()
      )
    );
$$;

ALTER FUNCTION public.get_public_slot_availability(date) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_public_slot_availability(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_slot_availability(date) TO anon, authenticated, service_role;
COMMIT;
