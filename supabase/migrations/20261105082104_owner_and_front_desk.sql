-- Owner and front-desk staff. Everyone with staff-side access keeps profiles.role = 'admin' (so every existing
-- check still lets them work); the new profiles.is_owner flag marks the owner. Front-desk staff can do everything
-- except Pricing and Settings: prices, payment and contact details, booking rules, staff access, and their history.
-- Existing staff accounts become owners, so nobody loses access.

BEGIN;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_owner boolean NOT NULL DEFAULT false;
UPDATE public.profiles SET is_owner = true WHERE role = 'admin';
-- An owner must have staff-side access
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_owner_is_staff;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_owner_is_staff CHECK (NOT is_owner OR role = 'admin');
-- Players edit only their name and phone (column grants from launch_hardening), so nobody can set is_owner themselves

CREATE OR REPLACE FUNCTION public.is_owner()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin' AND is_owner);
$$;
REVOKE ALL ON FUNCTION public.is_owner() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_owner() TO authenticated, service_role;

-- Settings row (prices, GCash, contact, booking rules) and peak rates: the owner writes, everyone still reads
ALTER POLICY booking_settings_admin_policy ON public.booking_settings
  USING (coalesce(auth.role(), '') = 'service_role' OR (current_user = 'postgres' AND auth.role() IS NULL) OR public.is_owner())
  WITH CHECK (coalesce(auth.role(), '') = 'service_role' OR (current_user = 'postgres' AND auth.role() IS NULL) OR public.is_owner());
ALTER POLICY peak_rates_admin_policy ON public.peak_rates
  USING (coalesce(auth.role(), '') = 'service_role' OR (current_user = 'postgres' AND auth.role() IS NULL) OR public.is_owner())
  WITH CHECK (coalesce(auth.role(), '') = 'service_role' OR (current_user = 'postgres' AND auth.role() IS NULL) OR public.is_owner());

-- The GCash QR image is the only file in club-assets
ALTER POLICY club_assets_insert_admin ON storage.objects WITH CHECK ((bucket_id = 'club-assets') AND public.is_owner());
ALTER POLICY club_assets_update_admin ON storage.objects
  USING ((bucket_id = 'club-assets') AND public.is_owner())
  WITH CHECK ((bucket_id = 'club-assets') AND public.is_owner());
ALTER POLICY club_assets_delete_admin ON storage.objects USING ((bucket_id = 'club-assets') AND public.is_owner());

-- Price and settings history are shown on the owner's pages
ALTER POLICY pricing_changes_admin_read ON public.pricing_changes USING (public.is_owner());
ALTER POLICY settings_changes_admin_read ON public.settings_changes USING (public.is_owner());

CREATE OR REPLACE FUNCTION public.save_pricing_settings(p_base_hourly_rate numeric, p_min_hours integer, p_max_hours integer, p_peak_rates jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_before jsonb;
  v_after jsonb;
BEGIN
  -- Prices are the owner's: front-desk staff can't change them
  IF coalesce(auth.role(), '') != 'service_role' AND NOT public.is_owner() THEN
    RAISE EXCEPTION 'FORBIDDEN: Only the owner can change prices' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(coalesce(p_peak_rates, '[]'::jsonb)) != 'array' THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: p_peak_rates must be a JSON array' USING ERRCODE = '22000';
  END IF;

  v_before := public.pricing_snapshot();

  -- Table CHECK constraints validate every value; a violation aborts the whole save
  UPDATE public.booking_settings
  SET base_hourly_rate = p_base_hourly_rate,
      min_hours = p_min_hours,
      max_hours = p_max_hours,
      updated_at = clock_timestamp(),
      updated_by = auth.uid()
  WHERE id;

  DELETE FROM public.peak_rates WHERE true;
  INSERT INTO public.peak_rates (label, days, start_time, end_time, hourly_rate)
  SELECT coalesce(r->>'label', ''),
         ARRAY(SELECT jsonb_array_elements_text(r->'days')),
         (r->>'start_time')::time,
         (r->>'end_time')::time,
         (r->>'hourly_rate')::numeric
  FROM jsonb_array_elements(coalesce(p_peak_rates, '[]'::jsonb)) AS r;

  -- Who changed what, kept with the save (nothing logged when the save changed nothing)
  v_after := public.pricing_snapshot();
  IF v_after IS DISTINCT FROM v_before THEN
    INSERT INTO public.pricing_changes (actor_id, before, after)
    VALUES ((SELECT id FROM public.profiles WHERE id = auth.uid()), v_before, v_after);
  END IF;

  RETURN jsonb_build_object(
    'base_hourly_rate', p_base_hourly_rate,
    'min_hours', p_min_hours,
    'max_hours', p_max_hours,
    'peak_rates', (SELECT count(*) FROM public.peak_rates)
  );
END;
$function$;

-- Staff access now has three levels: owner, front desk (staff), or none
DROP FUNCTION IF EXISTS public.set_staff_access(uuid, boolean);
CREATE OR REPLACE FUNCTION public.set_staff_access(p_user_id uuid, p_access text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_before text;
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'FORBIDDEN: Only the owner can change staff access' USING ERRCODE = '42501';
  END IF;
  IF p_access IS NULL OR p_access NOT IN ('owner', 'staff', 'none') THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: access must be owner, staff or none' USING ERRCODE = '22000';
  END IF;

  -- Serialise staff changes so two changes can't leave the venue with no owner
  LOCK TABLE public.profiles IN SHARE ROW EXCLUSIVE MODE;

  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Account does not exist' USING ERRCODE = 'P0002';
  END IF;
  v_before := CASE WHEN v_profile.role = 'admin' AND v_profile.is_owner THEN 'owner'
                   WHEN v_profile.role = 'admin' THEN 'staff' ELSE 'none' END;
  IF v_before = p_access THEN
    RETURN jsonb_build_object('id', v_profile.id, 'access', v_before, 'changed', false);
  END IF;
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'CANNOT_CHANGE_SELF: You cannot change your own access' USING ERRCODE = 'P0001';
  END IF;
  IF v_before = 'owner' AND (SELECT count(*) FROM public.profiles WHERE role = 'admin' AND is_owner) <= 1 THEN
    RAISE EXCEPTION 'LAST_OWNER: The venue must keep at least one owner' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.profiles
  SET role = CASE WHEN p_access = 'none' THEN 'customer' ELSE 'admin' END,
      is_owner = (p_access = 'owner')
  WHERE id = p_user_id;

  INSERT INTO public.settings_changes (actor_id, area, before, after)
  VALUES (
    (SELECT id FROM public.profiles WHERE id = auth.uid()),
    'staff',
    jsonb_build_object('account', coalesce(v_profile.email, v_profile.full_name), 'access', v_before),
    jsonb_build_object('account', coalesce(v_profile.email, v_profile.full_name), 'access', p_access)
  );

  RETURN jsonb_build_object('id', v_profile.id, 'access', p_access, 'changed', true);
END;
$$;
REVOKE ALL ON FUNCTION public.set_staff_access(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_staff_access(uuid, text) TO authenticated, service_role;

COMMIT;
