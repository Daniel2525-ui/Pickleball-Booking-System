-- Staff notes on customers (VIP, banned, needs invoice...). One short note per person, keyed by the member's
-- profile id or the walk-in's customers id (both appear as customer_directory.id). Kept in its own staff-only
-- table, not on profiles, because players can read their own profile row.
-- customer_directory gains a trailing note column (NULL for anyone but staff, by RLS).
-- Rollback: supabase/rollback_customer_notes.sql

BEGIN;

CREATE TABLE IF NOT EXISTS public.customer_notes (
  person_id uuid PRIMARY KEY,
  note text NOT NULL CHECK (char_length(note) BETWEEN 1 AND 300),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.customer_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_notes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS customer_notes_staff ON public.customer_notes;
CREATE POLICY customer_notes_staff ON public.customer_notes FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
REVOKE ALL ON public.customer_notes FROM anon, public;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_notes TO authenticated;
GRANT ALL ON public.customer_notes TO service_role;

CREATE OR REPLACE VIEW public.customer_directory WITH (security_invoker = true) AS
SELECT p.id, 'registered'::text AS type, p.full_name, p.email, p.phone, p.created_at,
       h.bookings_count, h.last_visit, h.no_shows, m.total_spent, n.note
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
LEFT JOIN public.customer_notes n ON n.person_id = p.id
WHERE coalesce(p.role, '') <> 'admin'
UNION ALL
SELECT c.id, 'walk_in'::text, c.full_name, c.email, c.phone, c.created_at,
       h.bookings_count, h.last_visit, h.no_shows, m.total_spent, n.note
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
) m
LEFT JOIN public.customer_notes n ON n.person_id = c.id;

COMMIT;
