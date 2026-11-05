-- Booking history: who did what to a booking and when (created, status changes, moves, payments, refunds).
-- Filled by triggers on bookings and payments, so every path is covered (staff buttons, walk-ins, moves,
-- checkout, the cron) without changing the existing functions. actor_id is auth.uid(): a staff member, the
-- player, or NULL for the system (cron, Stripe webhook). Staff can read it; nobody can write or edit it.

BEGIN;

CREATE TABLE IF NOT EXISTS public.booking_events (
  id bigserial PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  action text NOT NULL,
  detail text,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS booking_events_booking_idx ON public.booking_events (booking_id, created_at);

ALTER TABLE public.booking_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS booking_events_admin_read ON public.booking_events;
CREATE POLICY booking_events_admin_read ON public.booking_events
  FOR SELECT TO authenticated
  USING (public.is_admin());
-- No insert/update/delete policies: only the triggers below write, and history is never edited
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.booking_events FROM anon, authenticated;
REVOKE ALL ON public.booking_events FROM anon;

-- The actor, kept only when it is a real profile (a service-role call has no auth.uid())
CREATE OR REPLACE FUNCTION public.booking_event_actor()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT id FROM public.profiles WHERE id = auth.uid();
$$;
REVOKE ALL ON FUNCTION public.booking_event_actor() FROM PUBLIC, anon, authenticated;

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
      v_detail := CASE WHEN NEW.status = 'cancelled' THEN NEW.cancel_reason ELSE NULL END;
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
REVOKE ALL ON FUNCTION public.record_booking_event() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_payment_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_detail text := coalesce(NEW.payment_method, 'stripe') || CASE WHEN NEW.payment_reference IS NOT NULL THEN ' · ref ' || NEW.payment_reference ELSE '' END;
BEGIN
  BEGIN
    IF NEW.status = 'paid' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'paid') THEN
      INSERT INTO public.booking_events (booking_id, action, detail, actor_id)
      VALUES (NEW.booking_id, 'paid', v_detail || ' · ' || NEW.amount, public.booking_event_actor());
    ELSIF NEW.status = 'refunded' AND TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM 'refunded' THEN
      INSERT INTO public.booking_events (booking_id, action, detail, actor_id)
      VALUES (NEW.booking_id, 'refunded', coalesce(NEW.payment_method, 'stripe') || ' · ' || NEW.amount, public.booking_event_actor());
    END IF;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'payment history not recorded for %: %', NEW.booking_id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.record_payment_event() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS bookings_record_history ON public.bookings;
CREATE TRIGGER bookings_record_history
  AFTER INSERT OR UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.record_booking_event();

DROP TRIGGER IF EXISTS payments_record_history ON public.payments;
CREATE TRIGGER payments_record_history
  AFTER INSERT OR UPDATE OF status ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.record_payment_event();

COMMIT;
