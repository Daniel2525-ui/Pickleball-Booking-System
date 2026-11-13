-- Rollback for open_play_one_time_sessions. Revert the app first. Fails while one-time sessions exist:
-- cancel and remove them (with their bookings) before setting schedule_id back to NOT NULL.

BEGIN;

DROP FUNCTION IF EXISTS public.create_open_play_session(date, time, time, uuid[], int, numeric);
ALTER TABLE public.open_play_sessions ALTER COLUMN schedule_id SET NOT NULL;

COMMIT;
