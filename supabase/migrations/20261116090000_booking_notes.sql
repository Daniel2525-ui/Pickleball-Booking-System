-- Staff notes on a booking (deposit taken, bringing a coach...). One short note per booking, in its own
-- staff-only table like customer_notes: players can read their own bookings rows, so it can't live there.

BEGIN;

CREATE TABLE IF NOT EXISTS public.booking_notes (
  booking_id uuid PRIMARY KEY REFERENCES public.bookings(id) ON DELETE CASCADE,
  note text NOT NULL CHECK (char_length(note) BETWEEN 1 AND 300),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.booking_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_notes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS booking_notes_staff ON public.booking_notes;
CREATE POLICY booking_notes_staff ON public.booking_notes FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
REVOKE ALL ON public.booking_notes FROM anon, public;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.booking_notes TO authenticated;
GRANT ALL ON public.booking_notes TO service_role;

COMMIT;
