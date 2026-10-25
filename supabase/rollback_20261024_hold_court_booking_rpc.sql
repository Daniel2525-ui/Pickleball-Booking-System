-- ==============================================================================
-- Rollback Migration: rollback_20261024_hold_court_booking_rpc.sql
-- Description: Reverts hold_court_booking migration and restores the original
--              production 8-argument create_walk_in_booking signature with
--              hardened admin-only authorization and revoked anon access.
-- ==============================================================================

BEGIN;

-- 1. Remove forward migration RPCs to eliminate candidate ambiguity
DROP FUNCTION IF EXISTS public.hold_court_booking(uuid, date, time, time, uuid, numeric);
DROP FUNCTION IF EXISTS public.create_walk_in_booking(uuid, text, date, time, time, numeric, uuid, uuid, text);

-- 2. Restore production 8-argument create_walk_in_booking
CREATE OR REPLACE FUNCTION public.create_walk_in_booking(
  p_court_id uuid,
  p_customer_id uuid,
  p_customer_name text,
  p_booking_date date,
  p_start_time time,
  p_end_time time,
  p_amount numeric,
  p_payment_method text DEFAULT NULL
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
BEGIN
  -- 1. Authorization: Resolve caller identity and require admin privileges
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

  -- 2. Input validation
  IF p_start_time >= p_end_time THEN
    RAISE EXCEPTION 'INVALID_TIME_RANGE: start_time must be earlier than end_time' USING ERRCODE = '22000';
  END IF;

  IF trim(coalesce(p_customer_name, '')) = '' THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: customer_name is required' USING ERRCODE = '22000';
  END IF;

  IF p_customer_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: p_customer_id is required' USING ERRCODE = '22000';
  END IF;

  IF p_payment_method IS NOT NULL AND p_payment_method NOT IN ('cash', 'gcash') THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: payment_method must be cash, gcash, or null' USING ERRCODE = '22000';
  END IF;

  -- 3. Row lock court and verify existence
  SELECT status INTO v_court_status 
  FROM public.courts 
  WHERE id = p_court_id 
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Court does not exist' USING ERRCODE = 'P0002';
  END IF;

  -- 4. Check for overlapping active reservations
  SELECT id INTO v_conflict_id
  FROM public.bookings
  WHERE court_id = p_court_id
    AND booking_date = p_booking_date
    AND status IN ('confirmed', 'checked_in', 'in_progress', 'completed', 'pending')
    AND start_time < p_end_time
    AND end_time > p_start_time
  LIMIT 1;

  IF v_conflict_id IS NOT NULL THEN
    RAISE EXCEPTION 'SLOT_UNAVAILABLE' USING ERRCODE = 'P0001';
  END IF;

  -- 5. Insert confirmed walk-in booking
  INSERT INTO public.bookings (
    customer_id,
    customer_name,
    court_id,
    booking_date,
    start_time,
    end_time,
    status,
    total_amount
  ) VALUES (
    p_customer_id,
    trim(p_customer_name),
    p_court_id,
    p_booking_date,
    p_start_time,
    p_end_time,
    'confirmed',
    p_amount
  ) RETURNING id INTO v_booking_id;

  -- 6. Determine initial payment status
  IF p_payment_method IS NOT NULL THEN
    v_payment_status := 'paid';
    v_paid_at := now();
  ELSE
    v_payment_status := 'pending';
    v_paid_at := NULL;
  END IF;

  -- 7. Insert payment record
  INSERT INTO public.payments (
    booking_id,
    amount,
    currency,
    status,
    payment_method,
    paid_at
  ) VALUES (
    v_booking_id,
    p_amount,
    'php',
    v_payment_status,
    p_payment_method,
    v_paid_at
  );

  RETURN jsonb_build_object('booking_id', v_booking_id);
END;
$$;

-- 8. Restrict execution permissions: Revoke public and anon, grant authenticated and service_role
REVOKE ALL ON FUNCTION public.create_walk_in_booking(uuid, uuid, text, date, time, time, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_walk_in_booking(uuid, uuid, text, date, time, time, numeric, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_walk_in_booking(uuid, uuid, text, date, time, time, numeric, text) TO authenticated, service_role;

COMMIT;
