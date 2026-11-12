-- Rollback for *_day_ends_at_midnight.sql: new settings rows default to a 4 AM day cutoff again.
ALTER TABLE public.booking_settings ALTER COLUMN day_ends_at SET DEFAULT '04:00';
