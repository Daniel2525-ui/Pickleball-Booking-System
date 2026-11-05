-- Booking rules the owner can change in Settings: how many hours before start online cancellation closes, and
-- the no-show grace period. Defaults are today's values (2 hours, 15 minutes), so nothing changes until edited.
-- The settings history recorder now also logs these, as area 'policy'.

BEGIN;

ALTER TABLE public.booking_settings
  ADD COLUMN IF NOT EXISTS cancel_cutoff_hours integer NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS no_show_grace_minutes integer NOT NULL DEFAULT 15;

ALTER TABLE public.booking_settings DROP CONSTRAINT IF EXISTS booking_settings_cancel_cutoff_range;
ALTER TABLE public.booking_settings ADD CONSTRAINT booking_settings_cancel_cutoff_range CHECK (cancel_cutoff_hours BETWEEN 0 AND 72);
ALTER TABLE public.booking_settings DROP CONSTRAINT IF EXISTS booking_settings_no_show_grace_range;
ALTER TABLE public.booking_settings ADD CONSTRAINT booking_settings_no_show_grace_range CHECK (no_show_grace_minutes BETWEEN 0 AND 120);

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

COMMIT;
