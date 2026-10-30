-- ==============================================================================
-- Migration: handle_new_user_trigger
-- Description: records the sign-up trigger that until now existed only in the live database
--   (copied from pg_get_functiondef on 2026-10-30). Every new auth user gets a profiles row,
--   always with role 'customer'; admins are promoted by hand. Without it a database built from
--   these migrations has no profiles and every login fails.
--   Idempotent: safe to re-run, and a no-op on the live database.
-- ==============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
    INSERT INTO public.profiles (id, email, full_name, phone, role)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(
            NULLIF(NEW.raw_user_meta_data ->> 'full_name', ''),
            NULLIF(NEW.raw_user_meta_data ->> 'name', '')
        ),
        COALESCE(NEW.raw_user_meta_data ->> 'phone', ''),
        'customer'
    )
    ON CONFLICT (id) DO NOTHING;

    RETURN NEW;
END;
$function$;

-- Same lockdown as 20261102_launch_hardening, which skipped it when the function was missing
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

COMMIT;
