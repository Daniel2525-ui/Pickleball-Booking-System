-- Rollback for 20261105064928_settings_history.sql (drops the recorded settings history)

BEGIN;

DROP TRIGGER IF EXISTS booking_settings_record_changes ON public.booking_settings;
DROP FUNCTION IF EXISTS public.record_settings_change();
DROP TABLE IF EXISTS public.settings_changes;

COMMIT;
