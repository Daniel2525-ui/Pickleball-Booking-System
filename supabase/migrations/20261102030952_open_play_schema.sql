-- Open play: scheduled sessions where players book 1-4 spots.
-- A session holds one owner-less "block row" per court in bookings (so the existing exclusion
-- constraint blocks court bookings); a player's spots are a court-less bookings row.

BEGIN;

CREATE TABLE public.open_play_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day_of_week text NOT NULL CHECK (day_of_week IN ('Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday')),
  start_time time NOT NULL,
  end_time time NOT NULL,
  court_ids uuid[] NOT NULL CHECK (cardinality(court_ids) >= 1),
  capacity int NOT NULL CHECK (capacity > 0),
  price_per_spot numeric(10,2) NOT NULL CHECK (price_per_spot > 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time > start_time),
  CHECK (start_time = date_trunc('hour', start_time) AND end_time = date_trunc('hour', end_time))
);

CREATE TABLE public.open_play_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES public.open_play_schedules(id) ON DELETE RESTRICT,
  session_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  court_ids uuid[] NOT NULL,
  capacity int NOT NULL,
  price_per_spot numeric(10,2) NOT NULL,
  status text NOT NULL CHECK (status IN ('open','cancelled','flagged')),
  flag_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (schedule_id, session_date)
);

ALTER TABLE public.bookings
  ADD COLUMN open_play_session_id uuid REFERENCES public.open_play_sessions(id) ON DELETE RESTRICT,
  ADD COLUMN open_play_spots smallint,
  ALTER COLUMN court_id DROP NOT NULL,
  ADD CONSTRAINT bookings_court_or_open_play CHECK (
    (court_id IS NOT NULL AND open_play_spots IS NULL)
    OR (court_id IS NULL AND open_play_session_id IS NOT NULL AND open_play_spots BETWEEN 1 AND 4)
  );

ALTER TABLE public.bookings DROP CONSTRAINT bookings_customer_identity_check;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_customer_identity_check CHECK (
  (user_id IS NOT NULL AND customer_id IS NULL)
  OR (user_id IS NULL AND customer_id IS NOT NULL)
  OR (open_play_session_id IS NOT NULL AND open_play_spots IS NULL AND user_id IS NULL AND customer_id IS NULL)
);

CREATE INDEX bookings_open_play_session_idx ON public.bookings (open_play_session_id) WHERE open_play_session_id IS NOT NULL;

-- Admin only; customers read sessions through an RPC.
ALTER TABLE public.open_play_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.open_play_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY open_play_schedules_admin ON public.open_play_schedules FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY open_play_sessions_admin ON public.open_play_sessions FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Active spot rows: confirmed-ish, or a pending hold still inside its release window (infinity counts).
CREATE FUNCTION public.open_play_spots_taken(p_session_id uuid, p_exclude_booking uuid DEFAULT NULL)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT coalesce(sum(open_play_spots), 0)::integer FROM public.bookings
  WHERE open_play_session_id = p_session_id AND court_id IS NULL
    AND id IS DISTINCT FROM p_exclude_booking
    AND (status IN ('confirmed','checked_in','in_progress','completed')
      OR (status = 'pending' AND public.hold_release_after(hold_expires_at, created_at) > clock_timestamp()));
$$;

CREATE FUNCTION public.open_play_player_spots(p_session_id uuid, p_user_id uuid, p_customer_id uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT coalesce(sum(open_play_spots), 0)::integer FROM public.bookings
  WHERE open_play_session_id = p_session_id AND court_id IS NULL
    AND (user_id = p_user_id OR customer_id = p_customer_id)
    AND (status IN ('confirmed','checked_in','in_progress','completed')
      OR (status = 'pending' AND public.hold_release_after(hold_expires_at, created_at) > clock_timestamp()));
$$;

REVOKE ALL ON FUNCTION public.open_play_spots_taken(uuid, uuid), public.open_play_player_spots(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.open_play_spots_taken(uuid, uuid), public.open_play_player_spots(uuid, uuid, uuid) TO service_role;

COMMIT;
