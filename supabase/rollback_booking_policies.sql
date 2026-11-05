-- Rollback for 20261105064930_booking_policies.sql: restores the GCash-only recorder and drops the two columns

BEGIN;

CREATE OR REPLACE FUNCTION public.record_settings_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_before jsonb;
  v_after jsonb;
BEGIN
  BEGIN
    v_before := jsonb_build_object('account_name', OLD.gcash_account_name, 'number', OLD.gcash_number, 'qr_url', OLD.gcash_qr_url);
    v_after := jsonb_build_object('account_name', NEW.gcash_account_name, 'number', NEW.gcash_number, 'qr_url', NEW.gcash_qr_url);
    IF v_after IS DISTINCT FROM v_before THEN
      INSERT INTO public.settings_changes (actor_id, area, before, after)
      VALUES ((SELECT id FROM public.profiles WHERE id = auth.uid()), 'gcash', v_before, v_after);
    END IF;
  EXCEPTION WHEN others THEN
    -- The log must never block a settings save
    RAISE WARNING 'settings change not recorded: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;
ALTER TABLE public.booking_settings DROP CONSTRAINT IF EXISTS booking_settings_no_show_grace_range;
ALTER TABLE public.booking_settings DROP CONSTRAINT IF EXISTS booking_settings_cancel_cutoff_range;
ALTER TABLE public.booking_settings DROP COLUMN IF EXISTS no_show_grace_minutes;
ALTER TABLE public.booking_settings DROP COLUMN IF EXISTS cancel_cutoff_hours;

COMMIT;
