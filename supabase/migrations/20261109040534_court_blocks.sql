-- Court blocks: one court taken out for part of a day (coaching, private event, tournament, repairs).
-- Nobody can book a blocked court and time, staff included: a trigger on bookings raises exclusion_violation,
-- which every booking function (holds, walk-ins, moves) already turns into SLOT_UNAVAILABLE and open play
-- generation turns into a flagged session. The booking grids see blocks through get_public_slot_availability
-- as rows with status 'blocked' (reason hidden), so they show those hours as taken.
-- Bookings already in the way are refused by the API before a block is saved.
-- Rollback: supabase/rollback_court_blocks.sql

BEGIN;

CREATE TABLE IF NOT EXISTS public.court_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  court_id uuid NOT NULL REFERENCES public.courts (id) ON DELETE CASCADE,
  block_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  reason text CHECK (char_length(reason) <= 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT court_blocks_time_check CHECK (end_time > start_time)
);
CREATE INDEX IF NOT EXISTS court_blocks_day_idx ON public.court_blocks (block_date, court_id);

ALTER TABLE public.court_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.court_blocks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS court_blocks_staff ON public.court_blocks;
CREATE POLICY court_blocks_staff ON public.court_blocks FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
REVOKE ALL ON public.court_blocks FROM anon, public;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.court_blocks TO authenticated;
GRANT ALL ON public.court_blocks TO service_role;

-- SECURITY DEFINER: players cannot read court_blocks, but their bookings must still be checked against it
CREATE OR REPLACE FUNCTION public.reject_blocked_court_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.court_id IS NOT NULL
     AND NEW.status NOT IN ('cancelled', 'no_show')
     AND (TG_OP = 'INSERT'
          OR (NEW.court_id, NEW.booking_date, NEW.start_time, NEW.end_time)
             IS DISTINCT FROM (OLD.court_id, OLD.booking_date, OLD.start_time, OLD.end_time))
     AND EXISTS (
       SELECT 1 FROM public.court_blocks k
       WHERE k.court_id = NEW.court_id AND k.block_date = NEW.booking_date
         AND k.start_time < NEW.end_time AND k.end_time > NEW.start_time
     ) THEN
    RAISE EXCEPTION 'SLOT_UNAVAILABLE' USING ERRCODE = 'exclusion_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bookings_reject_blocked_court ON public.bookings;
CREATE TRIGGER bookings_reject_blocked_court
  BEFORE INSERT OR UPDATE OF court_id, booking_date, start_time, end_time ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.reject_blocked_court_booking();

-- Body unchanged from production except the trailing UNION ALL of blocks
CREATE OR REPLACE FUNCTION public.get_public_slot_availability(p_booking_date date)
RETURNS TABLE(id uuid, user_id uuid, court_id uuid, start_time time without time zone, end_time time without time zone,
              status text, hold_expires_at timestamp with time zone, open_play boolean)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT
    CASE WHEN b.user_id = auth.uid() THEN b.id ELSE NULL END AS id,
    CASE WHEN b.user_id = auth.uid() THEN b.user_id ELSE NULL END AS user_id,
    b.court_id,
    b.start_time,
    b.end_time,
    b.status,
    CASE WHEN b.user_id = auth.uid() THEN b.hold_expires_at ELSE NULL END AS hold_expires_at,
    b.open_play_session_id IS NOT NULL AS open_play
  FROM public.bookings b
  WHERE b.booking_date = p_booking_date
    AND b.court_id IS NOT NULL
    AND (
      b.status IN ('confirmed', 'completed', 'checked_in', 'in_progress')
      OR (
        b.status = 'pending'
        AND public.hold_release_after(b.hold_expires_at, b.created_at) > statement_timestamp()
      )
    )
  UNION ALL
  SELECT NULL::uuid, NULL::uuid, k.court_id, k.start_time, k.end_time, 'blocked', NULL::timestamptz, false
  FROM public.court_blocks k
  WHERE k.block_date = p_booking_date;
$function$;

COMMIT;
