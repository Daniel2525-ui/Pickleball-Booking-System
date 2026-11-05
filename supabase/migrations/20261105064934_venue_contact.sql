-- Venue contact details players see (landing, Terms, Privacy, booking pages): editable in Settings instead of code.
-- Defaults are the values the site shows today, so nothing changes until edited. Changes are logged as 'contact'.

BEGIN;

ALTER TABLE public.booking_settings
  ADD COLUMN IF NOT EXISTS venue_phone text NOT NULL DEFAULT '+63 917 123 4567',
  ADD COLUMN IF NOT EXISTS venue_email text NOT NULL DEFAULT 'play@crosshairdinkers.com',
  ADD COLUMN IF NOT EXISTS venue_address text NOT NULL DEFAULT 'J.C. Aquino Ave, Butuan City';

ALTER TABLE public.booking_settings DROP CONSTRAINT IF EXISTS booking_settings_venue_contact_check;
ALTER TABLE public.booking_settings ADD CONSTRAINT booking_settings_venue_contact_check CHECK (
  char_length(venue_phone) BETWEEN 7 AND 20 AND venue_phone ~ '^[+0-9 ()-]+$'
  AND char_length(venue_email) BETWEEN 3 AND 254 AND venue_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  AND char_length(venue_address) BETWEEN 3 AND 200
);

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

    v_before := jsonb_build_object('venue_phone', OLD.venue_phone, 'venue_email', OLD.venue_email, 'venue_address', OLD.venue_address);
    v_after := jsonb_build_object('venue_phone', NEW.venue_phone, 'venue_email', NEW.venue_email, 'venue_address', NEW.venue_address);
    IF v_after IS DISTINCT FROM v_before THEN
      INSERT INTO public.settings_changes (actor_id, area, before, after) VALUES (v_actor, 'contact', v_before, v_after);
    END IF;
  EXCEPTION WHEN others THEN
    -- The log must never block a settings save
    RAISE WARNING 'settings change not recorded: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

COMMIT;
