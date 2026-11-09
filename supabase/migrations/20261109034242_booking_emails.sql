-- Booking emails: confirmation once a booking is confirmed, and a reminder 24 hours before play.
-- Sent by the app (src/lib/services/bookings/bookingEmails.ts) from the cleanup cron and the PayMongo webhook.
-- Each column is claimed before sending (NULL -> now()), so two runs never email the same booking twice.
-- Bookings that already exist and are past pending are marked sent, so going live emails nobody about old bookings.
-- Rollback: supabase/rollback_booking_emails.sql
BEGIN;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS confirmation_sent_at timestamptz;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;

UPDATE public.bookings
SET confirmation_sent_at = now(), reminder_sent_at = now()
WHERE status <> 'pending' AND confirmation_sent_at IS NULL;

-- The sender scans confirmed bookings that still need an email
CREATE INDEX IF NOT EXISTS bookings_email_due_idx ON public.bookings (booking_date)
  WHERE status = 'confirmed' AND (confirmation_sent_at IS NULL OR reminder_sent_at IS NULL);

COMMIT;
