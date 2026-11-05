-- Rollback for profile_on_confirm: profiles are created at sign-up again, and the daily cleanup stops.
-- Profile rows removed for unconfirmed accounts are recreated below from their sign-up data.
BEGIN;

SELECT cron.unschedule('delete-stale-unconfirmed-users')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'delete-stale-unconfirmed-users');
DROP FUNCTION IF EXISTS public.delete_stale_unconfirmed_users();

DROP TRIGGER IF EXISTS on_auth_user_confirmed ON auth.users;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

INSERT INTO public.profiles (id, email, full_name, phone, role)
SELECT u.id, u.email,
       COALESCE(NULLIF(u.raw_user_meta_data ->> 'full_name', ''), NULLIF(u.raw_user_meta_data ->> 'name', '')),
       COALESCE(u.raw_user_meta_data ->> 'phone', ''), 'customer'
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id);

COMMIT;
