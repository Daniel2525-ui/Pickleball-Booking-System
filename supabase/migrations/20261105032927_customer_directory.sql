-- Customer directory: members (profiles, staff accounts left out) and walk-in records (customers) in one list,
-- each with its booking history, so the admin page can search, page and count on the server.
-- security_invoker: the caller's RLS applies, so staff see everyone and a player sees only their own row.

BEGIN;

CREATE OR REPLACE VIEW public.customer_directory WITH (security_invoker = true) AS
SELECT p.id, 'registered'::text AS type, p.full_name, p.email, p.phone, p.created_at,
       h.bookings_count, h.last_visit, h.no_shows, m.total_spent
FROM public.profiles p
CROSS JOIN LATERAL (
  -- Bookings that went ahead (cancelled and expired holds are not visits)
  SELECT count(*) FILTER (WHERE b.status IN ('confirmed', 'checked_in', 'in_progress', 'completed', 'no_show'))::int AS bookings_count,
         max(b.booking_date) FILTER (WHERE b.status IN ('checked_in', 'in_progress', 'completed')) AS last_visit,
         count(*) FILTER (WHERE b.status = 'no_show')::int AS no_shows
  FROM public.bookings b WHERE b.user_id = p.id
) h
CROSS JOIN LATERAL (
  SELECT coalesce(sum(pay.amount) FILTER (WHERE pay.status = 'paid'), 0)::numeric AS total_spent
  FROM public.payments pay JOIN public.bookings b ON b.id = pay.booking_id
  WHERE b.user_id = p.id
) m
WHERE coalesce(p.role, '') <> 'admin'
UNION ALL
SELECT c.id, 'walk_in'::text, c.full_name, c.email, c.phone, c.created_at,
       h.bookings_count, h.last_visit, h.no_shows, m.total_spent
FROM public.customers c
CROSS JOIN LATERAL (
  SELECT count(*) FILTER (WHERE b.status IN ('confirmed', 'checked_in', 'in_progress', 'completed', 'no_show'))::int AS bookings_count,
         max(b.booking_date) FILTER (WHERE b.status IN ('checked_in', 'in_progress', 'completed')) AS last_visit,
         count(*) FILTER (WHERE b.status = 'no_show')::int AS no_shows
  FROM public.bookings b WHERE b.customer_id = c.id
) h
CROSS JOIN LATERAL (
  SELECT coalesce(sum(pay.amount) FILTER (WHERE pay.status = 'paid'), 0)::numeric AS total_spent
  FROM public.payments pay JOIN public.bookings b ON b.id = pay.booking_id
  WHERE b.customer_id = c.id
) m;

REVOKE ALL ON public.customer_directory FROM anon, public;
GRANT SELECT ON public.customer_directory TO authenticated, service_role;

COMMIT;
