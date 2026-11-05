-- Cancel and keep the payment: staff decide case by case whether a cancelled paid booking is refunded.
-- 'payment_kept' marks the choice (the payment stays paid and is not owed back) and cancel_note holds why.
-- The history recorder now stores the note with the cancellation.

BEGIN;

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_cancel_reason_check;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_cancel_reason_check CHECK (
  cancel_reason IS NULL OR cancel_reason = ANY (ARRAY['expired', 'customer', 'admin', 'checkout_failed', 'slot_conflict',
    'court_unavailable', 'start_passed', 'gcash_rejected', 'payment_kept'])
);

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS cancel_note text;
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_cancel_note_length;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_cancel_note_length CHECK (char_length(cancel_note) <= 200);

CREATE OR REPLACE FUNCTION public.record_booking_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_action text;
  v_detail text;
  v_from text;
  v_to text;
BEGIN
  -- Open play court blocks are not bookings staff see; their session is managed on Open Play
  IF NEW.open_play_session_id IS NOT NULL AND NEW.court_id IS NOT NULL AND NEW.open_play_spots IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    IF TG_OP = 'INSERT' THEN
      INSERT INTO public.booking_events (booking_id, action, detail, actor_id)
      VALUES (NEW.id, 'created', NEW.status, public.booking_event_actor());
      RETURN NEW;
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
      v_action := CASE NEW.status
        WHEN 'confirmed' THEN 'confirmed'
        WHEN 'checked_in' THEN 'checked_in'
        WHEN 'in_progress' THEN 'started'
        WHEN 'completed' THEN 'completed'
        WHEN 'no_show' THEN 'no_show'
        WHEN 'cancelled' THEN 'cancelled'
        ELSE 'status_changed'
      END;
      -- "reason|note" when staff wrote a note (payment kept)
      v_detail := CASE WHEN NEW.status = 'cancelled' THEN NEW.cancel_reason || coalesce('|' || NEW.cancel_note, '') ELSE NULL END;
      INSERT INTO public.booking_events (booking_id, action, detail, actor_id)
      VALUES (NEW.id, v_action, v_detail, public.booking_event_actor());
    END IF;

    IF NEW.court_id IS DISTINCT FROM OLD.court_id OR NEW.booking_date IS DISTINCT FROM OLD.booking_date
       OR NEW.start_time IS DISTINCT FROM OLD.start_time OR NEW.end_time IS DISTINCT FROM OLD.end_time THEN
      SELECT coalesce(name, 'Court') || ' · ' || to_char(OLD.booking_date, 'Mon FMDD') || ' ' || to_char(OLD.start_time, 'FMHH12:MI AM')
        INTO v_from FROM public.courts WHERE id = OLD.court_id;
      SELECT coalesce(name, 'Court') || ' · ' || to_char(NEW.booking_date, 'Mon FMDD') || ' ' || to_char(NEW.start_time, 'FMHH12:MI AM')
        INTO v_to FROM public.courts WHERE id = NEW.court_id;
      INSERT INTO public.booking_events (booking_id, action, detail, actor_id)
      VALUES (NEW.id, 'moved', coalesce(v_from, '?') || ' → ' || coalesce(v_to, '?'), public.booking_event_actor());
    END IF;
  EXCEPTION WHEN others THEN
    -- History must never block the booking change itself
    RAISE WARNING 'booking history not recorded for %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;
COMMIT;
