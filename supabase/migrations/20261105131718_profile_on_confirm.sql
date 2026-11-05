-- ==============================================================================
-- Migration: profile_on_confirm
-- A player's profiles row is created when their email is confirmed, not at sign-up, so unconfirmed
-- sign-ups never reach the customer directory or its counts. Accounts left unconfirmed for 7 days
-- are deleted by a daily job. Only accounts with nothing attached are ever removed.
-- ==============================================================================

BEGIN;

-- Same insert as before (handle_new_user), now fired only once the email is confirmed:
-- at insert when the project auto-confirms (or an admin creates the user), otherwise when the link is clicked
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW WHEN (NEW.email_confirmed_at IS NOT NULL)
  EXECUTE FUNCTION public.handle_new_user();

DROP TRIGGER IF EXISTS on_auth_user_confirmed ON auth.users;
CREATE TRIGGER on_auth_user_confirmed
  AFTER UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW WHEN (OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL)
  EXECUTE FUNCTION public.handle_new_user();

-- Unconfirmed sign-ups made before this change: drop their profile rows (deleting a profile cascades
-- to bookings, so only rows with no bookings; an unconfirmed account can't sign in to book anyway)
DELETE FROM public.profiles p
USING auth.users u
WHERE u.id = p.id
  AND u.email_confirmed_at IS NULL
  AND p.role = 'customer'
  AND NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.user_id = p.id);

-- Sign-ups never confirmed within 7 days. Never touches an account that has a profile (and so data).
CREATE OR REPLACE FUNCTION public.delete_stale_unconfirmed_users()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM auth.users u
  WHERE u.email_confirmed_at IS NULL
    AND u.created_at < now() - interval '7 days'
    AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_stale_unconfirmed_users() FROM PUBLIC, anon, authenticated;

SELECT cron.unschedule('delete-stale-unconfirmed-users')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'delete-stale-unconfirmed-users');
-- 03:30 Manila (19:30 UTC), outside opening hours
SELECT cron.schedule('delete-stale-unconfirmed-users', '30 19 * * *', 'SELECT public.delete_stale_unconfirmed_users()');

COMMIT;
