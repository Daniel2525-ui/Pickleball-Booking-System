-- Live screens (admin dashboard and bookings, the player's My Bookings) refresh when a booking or payment changes.
-- Realtime still applies each table's RLS: players only hear about their own rows, staff about all.
ALTER PUBLICATION supabase_realtime ADD TABLE public.bookings, public.payments;
