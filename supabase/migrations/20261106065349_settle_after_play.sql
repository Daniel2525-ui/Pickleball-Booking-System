-- Counter payment after the game: a walk-in who pays after playing (booking confirmed, checked in, in progress
-- or already recorded as played) can be settled. Only an online hold (pending) still needs the pre-game checks.
CREATE OR REPLACE FUNCTION public.settle_counter_payment(p_booking_id uuid, p_payment_id uuid, p_payment_method text, p_payment_reference text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid;
  v_booking record;
  v_court record;
  v_payment record;
  v_conflict_id uuid;
  v_now timestamptz := clock_timestamp();
BEGIN
  -- Caller Authorization: Authenticated Admin
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_admin_id
  FROM public.profiles
  WHERE id = auth.uid() AND role = 'admin';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FORBIDDEN: Admin privileges required' USING ERRCODE = '42501';
  END IF;

  p_payment_method := lower(trim(p_payment_method));
  IF p_payment_method NOT IN ('cash', 'gcash') THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: payment_method must be cash or gcash' USING ERRCODE = '22000';
  END IF;

  IF p_payment_method = 'gcash' AND (p_payment_reference IS NULL OR trim(p_payment_reference) = '') THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: GCash settlement requires non-empty payment_reference' USING ERRCODE = '22000';
  END IF;

  -- 1. Lock bookings row (Hierarchy Level 1)
  SELECT id, court_id, booking_date, start_time, end_time, status, user_id, hold_expires_at, created_at
  INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Booking % does not exist', p_booking_id USING ERRCODE = 'P0002';
  END IF;

  -- pending: an online hold still within its checkout window; the others: a "Pay Later" walk-in, before or after play
  IF v_booking.status NOT IN ('pending', 'confirmed', 'checked_in', 'in_progress', 'completed') THEN
    RAISE EXCEPTION 'INVALID_STATUS: Booking is in status %, expected pending or confirmed', v_booking.status USING ERRCODE = '22000';
  END IF;

  -- Only a pending hold is still claiming its court; a booked walk-in already owns the slot, so time and court checks don't apply
  IF v_booking.status = 'pending' THEN
    -- An online hold whose timer ran out is over; staff record a new walk-in instead of reviving it
    IF coalesce(v_booking.hold_expires_at, v_booking.created_at + interval '35 minutes') <= v_now THEN
      RAISE EXCEPTION 'HOLD_EXPIRED: This online hold expired; record a new walk-in reservation instead' USING ERRCODE = '22000';
    END IF;

    -- Reject if match start time has passed in Asia/Manila (+08:00)
    IF ((v_booking.booking_date + v_booking.start_time) AT TIME ZONE 'Asia/Manila') <= v_now THEN
      RAISE EXCEPTION 'MATCH_START_PASSED: Scheduled start time has already passed' USING ERRCODE = '22000';
    END IF;

    -- 2. Lock courts row (Hierarchy Level 2)
    SELECT id, status INTO v_court
    FROM public.courts
    WHERE id = v_booking.court_id
    FOR UPDATE;

    IF NOT FOUND OR lower(coalesce(v_court.status, '')) != 'active' THEN
      RAISE EXCEPTION 'COURT_UNAVAILABLE: Court is not active' USING ERRCODE = 'P0001';
    END IF;

    SELECT id INTO v_conflict_id
    FROM public.bookings
    WHERE court_id = v_booking.court_id
      AND booking_date = v_booking.booking_date
      AND id != p_booking_id
      AND status IN ('confirmed', 'checked_in', 'in_progress', 'completed')
      AND start_time < v_booking.end_time
      AND end_time > v_booking.start_time
    LIMIT 1;

    IF v_conflict_id IS NOT NULL THEN
      RAISE EXCEPTION 'SLOT_UNAVAILABLE: Overlapping confirmed booking exists' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- 3. Lock payments row (Hierarchy Level 3)
  SELECT id, booking_id, status, amount
  INTO v_payment
  FROM public.payments
  WHERE id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Payment % does not exist', p_payment_id USING ERRCODE = 'P0002';
  END IF;

  IF v_payment.booking_id != p_booking_id THEN
    RAISE EXCEPTION 'MISMATCHED_ASSOCIATION: Payment does not belong to booking' USING ERRCODE = '22000';
  END IF;

  IF v_payment.status != 'pending' THEN
    RAISE EXCEPTION 'INVALID_STATUS: Payment is in status %, expected pending', v_payment.status USING ERRCODE = '22000';
  END IF;

  -- 4. Atomically update payment and booking rows
  UPDATE public.payments
  SET status = 'paid',
      payment_method = p_payment_method,
      payment_reference = trim(p_payment_reference),
      paid_at = v_now
  WHERE id = p_payment_id;

  -- A hold becomes confirmed; a walk-in keeps its game-day status (a played game stays played)
  IF v_booking.status = 'pending' THEN
    UPDATE public.bookings
    SET status = 'confirmed',
        hold_expires_at = NULL,
        updated_at = v_now
    WHERE id = p_booking_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', p_booking_id,
    'payment_id', p_payment_id,
    'status', CASE WHEN v_booking.status = 'pending' THEN 'confirmed' ELSE v_booking.status END,
    'paid_at', v_now
  );
END;
$function$;
