-- Rollback for 20261105044806_booking_history.sql (drops the recorded history)

BEGIN;

DROP TRIGGER IF EXISTS payments_record_history ON public.payments;
DROP TRIGGER IF EXISTS bookings_record_history ON public.bookings;
DROP FUNCTION IF EXISTS public.record_payment_event();
DROP FUNCTION IF EXISTS public.record_booking_event();
DROP FUNCTION IF EXISTS public.booking_event_actor();
DROP TABLE IF EXISTS public.booking_events;

COMMIT;
