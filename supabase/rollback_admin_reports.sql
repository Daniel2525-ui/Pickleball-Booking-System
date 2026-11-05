-- Rollback for admin_reports: removes the Reports page's database function. Nothing else depends on it.
DROP FUNCTION IF EXISTS public.get_venue_report(date, date);
