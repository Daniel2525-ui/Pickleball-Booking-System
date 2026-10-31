-- LOCAL STACK ONLY: realistic data for marketing screenshots. Undo with restore.sql.
BEGIN;
DELETE FROM public.refund_requests;
DELETE FROM public.payments;
DELETE FROM public.bookings;
DELETE FROM public.auth_rate_limits;

-- Production pricing and hours (read from prod 2026-10-31)
UPDATE public.booking_settings SET base_hourly_rate = 120, min_hours = 1, max_hours = 4,
  gcash_account_name = 'Crosshair Dinkers', gcash_number = '09171234567', gcash_qr_url = NULL;
UPDATE public.operating_hours SET is_open = true, open_time = '08:00', close_time = '22:00';
UPDATE public.operating_hours SET close_time = '23:00' WHERE day_of_week IN ('Friday', 'Saturday', 'Sunday');
UPDATE public.operating_hours SET open_time = '07:00' WHERE day_of_week = 'Saturday';

UPDATE public.profiles SET full_name = 'Juan Dela Cruz' WHERE full_name = 'E2E Customer';
UPDATE public.profiles SET full_name = 'Maria Santos' WHERE full_name = 'E2E Customer Two';

-- Other players' bookings tomorrow: a believable busy evening
WITH d AS (SELECT (now() AT TIME ZONE 'Asia/Manila')::date + 1 AS day),
other AS (SELECT id FROM public.profiles WHERE full_name = 'Maria Santos'),
slots(court, s, e) AS (VALUES
  ('COURT 1','08:00','09:00'), ('COURT 1','17:00','19:00'), ('COURT 1','19:00','21:00'),
  ('COURT 2','18:00','20:00'),
  ('COURT 3','09:00','11:00'), ('COURT 3','16:00','17:00'), ('COURT 3','20:00','22:00'),
  ('COURT 4','10:00','11:00'), ('COURT 4','17:00','18:00'), ('COURT 4','19:00','20:00'))
INSERT INTO public.bookings (user_id, customer_name, court_id, booking_date, start_time, end_time, status, total_amount, basket_id)
SELECT other.id, 'Maria Santos', c.id, d.day, slots.s::time, slots.e::time, 'confirmed',
       120 * extract(epoch FROM (slots.e::time - slots.s::time)) / 3600, gen_random_uuid()
FROM slots JOIN public.courts c ON c.name = slots.court, d, other;

-- Juan's own history: one upcoming paid booking, one played last week
WITH me AS (SELECT id FROM public.profiles WHERE full_name = 'Juan Dela Cruz'),
rows(court, day, s, e, st) AS (VALUES
  ('COURT 2', (now() AT TIME ZONE 'Asia/Manila')::date + 3, '18:00', '20:00', 'confirmed'),
  ('COURT 1', (now() AT TIME ZONE 'Asia/Manila')::date - 6, '19:00', '21:00', 'completed')),
ins AS (
  INSERT INTO public.bookings (user_id, customer_name, court_id, booking_date, start_time, end_time, status, total_amount, basket_id)
  SELECT me.id, 'Juan Dela Cruz', c.id, rows.day, rows.s::time, rows.e::time, rows.st, 240, gen_random_uuid()
  FROM rows JOIN public.courts c ON c.name = rows.court, me
  RETURNING id)
INSERT INTO public.payments (booking_id, amount, currency, status, payment_method, paid_at)
SELECT id, 240, 'php', 'paid', 'gcash', now() FROM ins;
COMMIT;
