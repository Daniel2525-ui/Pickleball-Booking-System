-- LOCAL STACK ONLY: back to the e2e defaults (same as tests/e2e/local-db.mjs resetBookings)
BEGIN;
DELETE FROM public.refund_requests;
DELETE FROM public.payments;
DELETE FROM public.bookings;
DELETE FROM public.auth_rate_limits;
UPDATE public.operating_hours SET is_open = true, open_time = '06:00', close_time = '22:00';
UPDATE public.booking_settings SET base_hourly_rate = 200, min_hours = 1, max_hours = 3,
  gcash_account_name = NULL, gcash_number = NULL, gcash_qr_url = NULL;
UPDATE public.profiles SET full_name = 'E2E Customer' WHERE full_name = 'Juan Dela Cruz';
UPDATE public.profiles SET full_name = 'E2E Customer Two' WHERE full_name = 'Maria Santos';
COMMIT;
