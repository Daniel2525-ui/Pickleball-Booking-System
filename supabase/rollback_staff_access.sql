-- Rollback for 20261105064929_staff_access.sql

BEGIN;

DROP FUNCTION IF EXISTS public.set_staff_access(uuid, boolean);

COMMIT;
