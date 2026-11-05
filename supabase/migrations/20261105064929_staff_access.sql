-- Staff access from the Settings page: staff give or remove staff access (profiles.role) for player accounts.
-- RLS lets nobody change a role through the API (users edit only their own row, never its role), so this
-- admin-only function is the one way in. It never removes the caller's own access or the last staff account,
-- and records each change in settings_changes.

BEGIN;

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

COMMIT;
