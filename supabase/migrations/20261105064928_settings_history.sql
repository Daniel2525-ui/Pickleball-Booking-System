-- Settings history: who changed the GCash payment details (where customers send money), when, and from what.
-- Recorded by a trigger on booking_settings, so every way of saving is covered. Staff can read it; nobody edits it.
-- Pricing columns on the same row are logged separately by save_pricing_settings (pricing_changes).

BEGIN;

CREATE TABLE IF NOT EXISTS public.settings_changes (
  id bigserial PRIMARY KEY,
  changed_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  area text NOT NULL,
  before jsonb NOT NULL,
  after jsonb NOT NULL
);

ALTER TABLE public.settings_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings_changes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS settings_changes_admin_read ON public.settings_changes;
CREATE POLICY settings_changes_admin_read ON public.settings_changes
  FOR SELECT TO authenticated
  USING (public.is_admin());
REVOKE ALL ON public.settings_changes FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.settings_changes FROM authenticated;

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
REVOKE ALL ON FUNCTION public.record_settings_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS booking_settings_record_changes ON public.booking_settings;
CREATE TRIGGER booking_settings_record_changes
  AFTER UPDATE ON public.booking_settings
  FOR EACH ROW EXECUTE FUNCTION public.record_settings_change();

COMMIT;
