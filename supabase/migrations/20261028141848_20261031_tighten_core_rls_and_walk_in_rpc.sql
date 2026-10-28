-- ==============================================================================
-- Migration: 20261031_tighten_core_rls_and_walk_in_rpc.sql
-- Description: 
--   1. Tighten profiles update RLS to prevent privilege escalation (cannot modify role).
--   2. Enable RLS on public.customers to protect walk-in customer data.
--   3. Restrict payments & bookings UPDATE and DELETE policies so customers cannot
--      arbitrarily confirm, alter, or delete payment and reservation records.
--   4. Update create_walk_in_booking RPC:
--      - Accepts optional p_payment_reference to persist references atomically.
--      - Ignores expired pending holds (hold_expires_at <= now) in conflict checks.
-- ==============================================================================

BEGIN;

-- 1. Profiles Table RLS — Prevent privilege escalation
DROP POLICY IF EXISTS profiles_update_policy ON public.profiles;
CREATE POLICY profiles_update_policy ON public.profiles
  FOR UPDATE
  USING (
    id = auth.uid()
    OR coalesce(auth.role(), '') = 'service_role'
    OR (current_user = 'postgres' AND auth.role() IS NULL)
  )
  WITH CHECK (
    coalesce(auth.role(), '') = 'service_role'
    OR (current_user = 'postgres' AND auth.role() IS NULL)
    OR (
      id = auth.uid()
      AND role IS NOT DISTINCT FROM (SELECT p.role FROM public.profiles p WHERE p.id = auth.uid())
    )
  );

-- 2. Customers Table RLS — Protect walk-in customer records
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customers_select_policy ON public.customers;
CREATE POLICY customers_select_policy ON public.customers
  FOR SELECT
  USING (
    coalesce(auth.role(), '') = 'service_role'
    OR (current_user = 'postgres' AND auth.role() IS NULL)
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS customers_admin_policy ON public.customers;
CREATE POLICY customers_admin_policy ON public.customers
  FOR ALL
  USING (
    coalesce(auth.role(), '') = 'service_role'
    OR (current_user = 'postgres' AND auth.role() IS NULL)
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- 3. Bookings Table RLS — Prevent arbitrary customer tampering and deletion
DROP POLICY IF EXISTS bookings_update_policy ON public.bookings;
CREATE POLICY bookings_update_policy ON public.bookings
  FOR UPDATE
  USING (
    coalesce(auth.role(), '') = 'service_role'
    OR (current_user = 'postgres' AND auth.role() IS NULL)
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    OR (user_id = auth.uid() AND status IN ('pending', 'confirmed'))
  )
  WITH CHECK (
    coalesce(auth.role(), '') = 'service_role'
    OR (current_user = 'postgres' AND auth.role() IS NULL)
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    OR (user_id = auth.uid() AND status = 'cancelled')
  );

DROP POLICY IF EXISTS bookings_delete_policy ON public.bookings;
CREATE POLICY bookings_delete_policy ON public.bookings
  FOR DELETE
  USING (
    coalesce(auth.role(), '') = 'service_role'
    OR (current_user = 'postgres' AND auth.role() IS NULL)
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- 4. Payments Table RLS — Prevent customer payment tampering and deletion
DROP POLICY IF EXISTS payments_update_policy ON public.payments;
CREATE POLICY payments_update_policy ON public.payments
  FOR UPDATE
  USING (
    coalesce(auth.role(), '') = 'service_role'
    OR (current_user = 'postgres' AND auth.role() IS NULL)
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    OR (EXISTS (SELECT 1 FROM public.bookings b WHERE b.id = booking_id AND b.user_id = auth.uid()) AND status = 'pending')
  )
  WITH CHECK (
    coalesce(auth.role(), '') = 'service_role'
    OR (current_user = 'postgres' AND auth.role() IS NULL)
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    OR (EXISTS (SELECT 1 FROM public.bookings b WHERE b.id = booking_id AND b.user_id = auth.uid()) AND status = 'failed')
  );

DROP POLICY IF EXISTS payments_delete_policy ON public.payments;
CREATE POLICY payments_delete_policy ON public.payments
  FOR DELETE
  USING (
    coalesce(auth.role(), '') = 'service_role'
    OR (current_user = 'postgres' AND auth.role() IS NULL)
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- 5. Drop legacy 9-parameter create_walk_in_booking overload to avoid PostgREST ambiguity
DROP FUNCTION IF EXISTS public.create_walk_in_booking(uuid, text, date, time, time, numeric, uuid, uuid, text);

-- 6. Deploy enhanced 10-parameter create_walk_in_booking with hold expiry & payment reference
CREATE OR REPLACE FUNCTION public.create_walk_in_booking(
  p_court_id uuid,
  p_customer_name text,
  p_booking_date date,
  p_start_time time,
  p_end_time time,
  p_amount numeric,
  p_customer_id uuid DEFAULT NULL,
  p_user_id uuid DEFAULT NULL,
  p_payment_method text DEFAULT NULL,
  p_payment_reference text DEFAULT NULL
) RETURNS jsonb 
LANGUAGE plpgsql 
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_is_service_role boolean;
  v_court_status text;
  v_conflict_id uuid;
  v_booking_id uuid;
  v_payment_status text;
  v_paid_at timestamptz;
  v_now_manila timestamp;
  v_day_of_week text;
  v_is_open boolean;
  v_open_time time;
  v_close_time time;
  v_duration_hours integer;
  v_expected_amount numeric;
BEGIN
  -- 1. Evaluate caller authorization
  v_is_service_role := (
    coalesce(auth.role(), '') = 'service_role'
    OR (session_user = 'postgres' AND auth.role() IS NULL)
  );

  IF NOT v_is_service_role THEN
    IF auth.uid() IS NULL OR coalesce(auth.role(), '') != 'authenticated' THEN
      RAISE EXCEPTION 'UNAUTHORIZED: Authentication required to record walk-in reservations' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() AND role = 'admin'
    ) THEN
      RAISE EXCEPTION 'FORBIDDEN: Admin privileges required to record walk-in reservations' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 2. Validate input parameters
  IF p_start_time >= p_end_time THEN
    RAISE EXCEPTION 'INVALID_TIME_RANGE: start_time must be earlier than end_time' USING ERRCODE = '22000';
  END IF;

  IF trim(coalesce(p_customer_name, '')) = '' THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: customer_name is required' USING ERRCODE = '22000';
  END IF;

  IF (p_customer_id IS NULL AND p_user_id IS NULL) OR (p_customer_id IS NOT NULL AND p_user_id IS NOT NULL) THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Exactly one of p_customer_id or p_user_id must be provided' USING ERRCODE = '22000';
  END IF;

  IF p_payment_method IS NOT NULL AND p_payment_method NOT IN ('cash', 'gcash') THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: payment_method must be cash, gcash, or null' USING ERRCODE = '22000';
  END IF;

  IF date_part('minute', p_start_time) != 0 
     OR date_part('second', p_start_time) != 0 
     OR date_part('minute', p_end_time) != 0 
     OR date_part('second', p_end_time) != 0 THEN
    RAISE EXCEPTION 'INVALID_TIME_INCREMENT: Reservations must be booked in whole-hour increments on the hour' USING ERRCODE = '22000';
  END IF;

  v_duration_hours := (date_part('epoch', (p_end_time - p_start_time)) / 3600)::integer;
  IF v_duration_hours < 1 OR v_duration_hours > 3 OR (p_end_time - p_start_time) != (v_duration_hours || ' hours')::interval THEN
    RAISE EXCEPTION 'INVALID_DURATION: Booking duration must be between 1 and 3 consecutive hours' USING ERRCODE = '22000';
  END IF;

  v_expected_amount := v_duration_hours * 200;
  IF p_amount IS NOT NULL AND p_amount != v_expected_amount THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: Expected amount of % PHP for % hour(s), but received % PHP', v_expected_amount, v_duration_hours, p_amount USING ERRCODE = '22000';
  END IF;
  p_amount := v_expected_amount;

  -- 3. Prevent recording walk-ins for slots that have already ended
  v_now_manila := timezone('Asia/Manila', now());
  IF (p_booking_date + p_end_time) <= v_now_manila THEN
    RAISE EXCEPTION 'PAST_SLOT: The requested time slot has already ended' USING ERRCODE = '22000';
  END IF;

  -- 4. Verify operating hours
  v_day_of_week := CASE date_part('dow', p_booking_date)::integer
    WHEN 0 THEN 'Sunday'
    WHEN 1 THEN 'Monday'
    WHEN 2 THEN 'Tuesday'
    WHEN 3 THEN 'Wednesday'
    WHEN 4 THEN 'Thursday'
    WHEN 5 THEN 'Friday'
    WHEN 6 THEN 'Saturday'
  END;
  SELECT is_open, open_time, close_time
  INTO v_is_open, v_open_time, v_close_time
  FROM public.operating_hours
  WHERE day_of_week = v_day_of_week;

  IF NOT FOUND OR v_is_open = false OR v_open_time IS NULL OR v_close_time IS NULL THEN
    RAISE EXCEPTION 'VENUE_CLOSED: The venue is closed on this date' USING ERRCODE = 'P0001';
  END IF;

  IF p_start_time < v_open_time OR p_end_time > v_close_time THEN
    RAISE EXCEPTION 'OUTSIDE_OPERATING_HOURS: The selected time range falls outside venue operating hours' USING ERRCODE = '22000';
  END IF;

  -- 5. Acquire exclusive row lock on court
  SELECT status INTO v_court_status
  FROM public.courts
  WHERE id = p_court_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Court does not exist' USING ERRCODE = 'P0002';
  END IF;

  IF lower(coalesce(v_court_status, '')) != 'active' THEN
    RAISE EXCEPTION 'COURT_UNAVAILABLE: Court is currently not available for reservations' USING ERRCODE = 'P0001';
  END IF;

  -- 6. Check for overlapping active reservations (expired pending holds do NOT conflict)
  SELECT id INTO v_conflict_id
  FROM public.bookings
  WHERE court_id = p_court_id
    AND booking_date = p_booking_date
    AND (
      status IN ('confirmed', 'checked_in', 'in_progress', 'completed')
      OR (
        status = 'pending'
        AND coalesce(hold_expires_at, created_at + interval '35 minutes') > clock_timestamp()
      )
    )
    AND start_time < p_end_time
    AND end_time > p_start_time
  LIMIT 1;

  IF v_conflict_id IS NOT NULL THEN
    RAISE EXCEPTION 'SLOT_UNAVAILABLE' USING ERRCODE = 'P0001';
  END IF;

  -- 7. Insert confirmed booking
  INSERT INTO public.bookings (
    user_id,
    customer_id,
    customer_name,
    court_id,
    booking_date,
    start_time,
    end_time,
    status,
    total_amount
  ) VALUES (
    p_user_id,
    p_customer_id,
    trim(p_customer_name),
    p_court_id,
    p_booking_date,
    p_start_time,
    p_end_time,
    'confirmed',
    p_amount
  ) RETURNING id INTO v_booking_id;

  -- 8. Determine initial payment status
  IF p_payment_method IS NOT NULL THEN
    v_payment_status := 'paid';
    v_paid_at := now();
  ELSE
    v_payment_status := 'pending';
    v_paid_at := NULL;
  END IF;

  -- 9. Insert payment atomically with optional payment reference
  INSERT INTO public.payments (
    booking_id,
    amount,
    currency,
    status,
    payment_method,
    payment_reference,
    paid_at
  ) VALUES (
    v_booking_id,
    p_amount,
    'php',
    v_payment_status,
    p_payment_method,
    p_payment_reference,
    v_paid_at
  );

  RETURN jsonb_build_object('booking_id', v_booking_id);
END;
$$;

REVOKE ALL ON FUNCTION public.create_walk_in_booking(uuid, text, date, time, time, numeric, uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_walk_in_booking(uuid, text, date, time, time, numeric, uuid, uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_walk_in_booking(uuid, text, date, time, time, numeric, uuid, uuid, text, text) TO authenticated, service_role;

COMMIT;
