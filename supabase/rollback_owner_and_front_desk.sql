-- Rollback for 20261105082104_owner_and_front_desk.sql: every staff account gets full access again (owner flag dropped).

BEGIN;

DROP FUNCTION IF EXISTS public.set_staff_access(uuid, text);
CREATE OR REPLACE FUNCTION public.set_staff_access(p_user_id uuid, p_is_staff boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_new_role text := CASE WHEN p_is_staff THEN 'admin' ELSE 'customer' END;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN: Admin privileges required' USING ERRCODE = '42501';
  END IF;

  -- Serialise staff changes so two removals can't leave the venue with no staff
  LOCK TABLE public.profiles IN SHARE ROW EXCLUSIVE MODE;

  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Account does not exist' USING ERRCODE = 'P0002';
  END IF;
  IF v_profile.role = v_new_role THEN
    RETURN jsonb_build_object('id', v_profile.id, 'role', v_profile.role, 'changed', false);
  END IF;
  IF NOT p_is_staff AND p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'CANNOT_REMOVE_SELF: You cannot remove your own staff access' USING ERRCODE = 'P0001';
  END IF;
  IF NOT p_is_staff AND (SELECT count(*) FROM public.profiles WHERE role = 'admin') <= 1 THEN
    RAISE EXCEPTION 'LAST_STAFF: The venue must keep at least one staff account' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.profiles SET role = v_new_role WHERE id = p_user_id;

  INSERT INTO public.settings_changes (actor_id, area, before, after)
  VALUES (
    (SELECT id FROM public.profiles WHERE id = auth.uid()),
    'staff',
    jsonb_build_object('account', coalesce(v_profile.email, v_profile.full_name), 'access', v_profile.role),
    jsonb_build_object('account', coalesce(v_profile.email, v_profile.full_name), 'access', v_new_role)
  );

  RETURN jsonb_build_object('id', v_profile.id, 'role', v_new_role, 'changed', true);
END;
$$;

REVOKE ALL ON FUNCTION public.set_staff_access(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_staff_access(uuid, boolean) TO authenticated, service_role;


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
  IF coalesce(auth.role(), '') != 'service_role'
     AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'FORBIDDEN: Admin privileges required' USING ERRCODE = '42501';
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

ALTER POLICY settings_changes_admin_read ON public.settings_changes USING (public.is_admin());
ALTER POLICY pricing_changes_admin_read ON public.pricing_changes USING (public.is_admin());
ALTER POLICY club_assets_delete_admin ON storage.objects USING ((bucket_id = 'club-assets') AND public.is_admin());
ALTER POLICY club_assets_update_admin ON storage.objects
  USING ((bucket_id = 'club-assets') AND public.is_admin()) WITH CHECK ((bucket_id = 'club-assets') AND public.is_admin());
ALTER POLICY club_assets_insert_admin ON storage.objects WITH CHECK ((bucket_id = 'club-assets') AND public.is_admin());
ALTER POLICY peak_rates_admin_policy ON public.peak_rates USING (coalesce(auth.role(), '') = 'service_role' OR (current_user = 'postgres' AND auth.role() IS NULL) OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')) WITH CHECK (coalesce(auth.role(), '') = 'service_role' OR (current_user = 'postgres' AND auth.role() IS NULL) OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
ALTER POLICY booking_settings_admin_policy ON public.booking_settings USING (coalesce(auth.role(), '') = 'service_role' OR (current_user = 'postgres' AND auth.role() IS NULL) OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')) WITH CHECK (coalesce(auth.role(), '') = 'service_role' OR (current_user = 'postgres' AND auth.role() IS NULL) OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

DROP FUNCTION IF EXISTS public.is_owner();
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_owner_is_staff;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS is_owner;

COMMIT;
