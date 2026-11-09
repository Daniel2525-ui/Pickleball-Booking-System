-- Rollback for *_court_blocks.sql: restores get_public_slot_availability and drops court blocks (blocks are lost).
BEGIN;
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
    );
$function$;
DROP TRIGGER IF EXISTS bookings_reject_blocked_court ON public.bookings;
DROP FUNCTION IF EXISTS public.reject_blocked_court_booking();
DROP TABLE IF EXISTS public.court_blocks;
COMMIT;
