-- Rollback for 20261105064934_venue_contact.sql: restores the recorder without contact logging, drops the columns

BEGIN;

CREATE OR REPLACE FUNCTION public.record_settings_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid;
  v_before jsonb;
  v_after jsonb;
BEGIN
  BEGIN
    v_actor := (SELECT id FROM public.profiles WHERE id = auth.uid());

    v_before := jsonb_build_object('account_name', OLD.gcash_account_name, 'number', OLD.gcash_number, 'qr_url', OLD.gcash_qr_url);
    v_after := jsonb_build_object('account_name', NEW.gcash_account_name, 'number', NEW.gcash_number, 'qr_url', NEW.gcash_qr_url);
    IF v_after IS DISTINCT FROM v_before THEN
      INSERT INTO public.settings_changes (actor_id, area, before, after) VALUES (v_actor, 'gcash', v_before, v_after);
    END IF;

    v_before := jsonb_build_object('cancel_cutoff_hours', OLD.cancel_cutoff_hours, 'no_show_grace_minutes', OLD.no_show_grace_minutes);
    v_after := jsonb_build_object('cancel_cutoff_hours', NEW.cancel_cutoff_hours, 'no_show_grace_minutes', NEW.no_show_grace_minutes);
    IF v_after IS DISTINCT FROM v_before THEN
      INSERT INTO public.settings_changes (actor_id, area, before, after) VALUES (v_actor, 'policy', v_before, v_after);
    END IF;
  EXCEPTION WHEN others THEN
    -- The log must never block a settings save
    RAISE WARNING 'settings change not recorded: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

ALTER TABLE public.booking_settings DROP CONSTRAINT IF EXISTS booking_settings_venue_contact_check;
ALTER TABLE public.booking_settings DROP COLUMN IF EXISTS venue_address;
ALTER TABLE public.booking_settings DROP COLUMN IF EXISTS venue_email;
ALTER TABLE public.booking_settings DROP COLUMN IF EXISTS venue_phone;

COMMIT;
