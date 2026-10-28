-- ==============================================================================
-- Rollback Migration: rollback_20261101_secure_profiles_and_public_slot_availability.sql
-- Description:
--   Rolls back migration 20261101 by:
--   1. Dropping get_public_slot_availability RPC.
--   2. Restoring previous public read policies on public.bookings and public.profiles.
--   3. Dropping public.is_admin() helper.
-- ==============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.get_public_slot_availability(date);

DROP POLICY IF EXISTS bookings_select_policy ON public.bookings;
CREATE POLICY bookings_select_policy ON public.bookings
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS profiles_select_policy ON public.profiles;
CREATE POLICY profiles_select_policy ON public.profiles
  FOR SELECT
  USING (true);

DROP FUNCTION IF EXISTS public.is_admin();

COMMIT;
