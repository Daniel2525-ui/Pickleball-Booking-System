-- Rollback for *_booking_emails.sql: drops the email tracking columns (the app then logs a select error and sends nothing).
BEGIN;
DROP INDEX IF EXISTS public.bookings_email_due_idx;
ALTER TABLE public.bookings DROP COLUMN IF EXISTS reminder_sent_at;
ALTER TABLE public.bookings DROP COLUMN IF EXISTS confirmation_sent_at;
COMMIT;
