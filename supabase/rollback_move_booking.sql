-- Rollback for 20261105042752_move_booking.sql

BEGIN;

DROP FUNCTION IF EXISTS public.move_booking(uuid, uuid, date, time);

COMMIT;
