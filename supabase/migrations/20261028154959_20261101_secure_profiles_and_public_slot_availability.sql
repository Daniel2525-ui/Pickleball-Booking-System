-- ==============================================================================
-- Migration: 20261101_secure_profiles_and_public_slot_availability.sql
-- Description:
--   1. Deploys non-recursive public.is_admin() SECURITY DEFINER helper owned by postgres.
--   2. Restricts public.profiles SELECT: authenticated users can only view their own
--      profile; administrators and service role can view all profiles.
--      (Preserves existing profiles_update_policy role-escalation guard from 20261031).
--   3. Restricts public.bookings SELECT: direct access limited to booking owner,
--      administrators, and service role.
--   4. Deploys public.get_public_slot_availability(p_booking_date date) RPC:
--      Returns active slots for the public court grid while masking customer identity,
--      withholding hold_expires_at from other users, excluding created_at, and
--      filtering out expired holds via statement_timestamp().
-- ==============================================================================

BEGIN;

-- 1. Non-recursive admin verification function
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

ALTER FUNCTION public.is_admin() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_admin() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;

-- 2. Secure profiles SELECT policy
DROP POLICY IF EXISTS profiles_select_policy ON public.profiles;
CREATE POLICY profiles_select_policy ON public.profiles
  FOR SELECT
  TO authenticated, service_role
  USING (
    coalesce(auth.role(), '') = 'service_role'
    OR (current_user = 'postgres' AND auth.role() IS NULL)
    OR id = auth.uid()
    OR public.is_admin()
  );

-- 3. Secure bookings SELECT policy (direct table read restricted)
DROP POLICY IF EXISTS bookings_select_policy ON public.bookings;
CREATE POLICY bookings_select_policy ON public.bookings
  FOR SELECT
  TO authenticated, service_role
  USING (
    coalesce(auth.role(), '') = 'service_role'
    OR (current_user = 'postgres' AND auth.role() IS NULL)
    OR user_id = auth.uid()
    OR public.is_admin()
  );

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
