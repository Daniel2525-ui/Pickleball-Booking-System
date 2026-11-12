-- A new venue's business day runs midnight to midnight; only a venue that opens past midnight moves the cutoff
-- (hours page, "Day ends at"). Changes the default only: existing settings rows keep their value.
-- Rollback: supabase/rollback_day_ends_at_midnight.sql
ALTER TABLE public.booking_settings ALTER COLUMN day_ends_at SET DEFAULT '00:00';
