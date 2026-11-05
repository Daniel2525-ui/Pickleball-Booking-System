-- Rollback for 20261105020605_court_maintenance_note.sql

BEGIN;

ALTER TABLE public.courts DROP CONSTRAINT IF EXISTS courts_maintenance_note_length;
ALTER TABLE public.courts DROP COLUMN IF EXISTS maintenance_until, DROP COLUMN IF EXISTS maintenance_note;

COMMIT;
