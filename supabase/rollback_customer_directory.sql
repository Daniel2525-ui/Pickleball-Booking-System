-- Rollback for 20261105032927_customer_directory.sql

BEGIN;

DROP VIEW IF EXISTS public.customer_directory;

COMMIT;
