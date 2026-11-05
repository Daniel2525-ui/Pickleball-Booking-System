-- App schema snapshot, made by scripts/dump-schema.sh. Do not edit by hand.
-- Includes every migration up to and including: 20261105082104_owner_and_front_desk.sql
-- Rebuild: load this into a new Supabase stack, then apply only migrations newer than that file.
-- Not included: the pg_cron job (see *_supabase_cron_cleanup.sql; it needs Vault secrets set by hand).

create schema if not exists public;
create extension if not exists btree_gist with schema public;
--
-- PostgreSQL database dump
--

\restrict schemasnapshot

-- Dumped from database version 17.11
-- Dumped by pg_dump version 17.11

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: add_open_play_walkup(uuid, uuid, text, integer, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.add_open_play_walkup(p_session_id uuid, p_customer_id uuid, p_customer_name text, p_spots integer, p_payment_method text, p_payment_reference text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_session record;
  v_amount numeric;
  v_booking_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN: Admin privileges required' USING ERRCODE = '42501';
  END IF;
  IF p_customer_id IS NULL OR trim(coalesce(p_customer_name, '')) = '' THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: customer and customer_name are required' USING ERRCODE = '22000';
  END IF;
  IF p_spots IS NULL OR p_spots NOT BETWEEN 1 AND 4 THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: spots must be 1-4' USING ERRCODE = '22000';
  END IF;
  IF p_payment_method IS NULL OR p_payment_method NOT IN ('cash', 'gcash') THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: payment_method must be cash or gcash' USING ERRCODE = '22000';
  END IF;
  IF p_payment_method = 'gcash' AND trim(coalesce(p_payment_reference, '')) = '' THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: a GCash reference is required' USING ERRCODE = '22000';
  END IF;

  SELECT * INTO v_session FROM public.open_play_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Session does not exist' USING ERRCODE = 'P0002';
  END IF;
  -- Staff may add players after the start, so only the status is checked
  IF v_session.status != 'open' THEN
    RAISE EXCEPTION 'SESSION_UNAVAILABLE' USING ERRCODE = 'P0001';
  END IF;
  IF public.open_play_spots_taken(p_session_id) + p_spots > v_session.capacity THEN
    RAISE EXCEPTION 'SESSION_FULL' USING ERRCODE = 'P0001';
  END IF;
  IF public.open_play_player_spots(p_session_id, NULL, p_customer_id) + p_spots > 4 THEN
    RAISE EXCEPTION 'PLAYER_LIMIT' USING ERRCODE = 'P0001';
  END IF;

  v_amount := p_spots * v_session.price_per_spot;

  INSERT INTO public.bookings (
    customer_id, customer_name, open_play_session_id, open_play_spots, booking_date, start_time, end_time,
    status, total_amount
  ) VALUES (
    p_customer_id, trim(p_customer_name), p_session_id, p_spots, v_session.session_date, v_session.start_time, v_session.end_time,
    'confirmed', v_amount
  ) RETURNING id INTO v_booking_id;

  INSERT INTO public.payments (booking_id, amount, currency, status, payment_method, payment_reference, paid_at)
  VALUES (v_booking_id, v_amount, 'php', 'paid', p_payment_method, p_payment_reference, now());

  RETURN jsonb_build_object('booking_id', v_booking_id, 'amount', v_amount);
END;
$$;


--
-- Name: approve_gcash_basket(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.approve_gcash_basket(p_basket_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_ids uuid[];
  v_amount numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'FORBIDDEN: Admin privileges required' USING ERRCODE = '42501';
  END IF;

  -- Only submitted rows: a court cancelled meanwhile is left alone
  SELECT array_agg(id), sum(total_amount) INTO v_ids, v_amount
  FROM (
    SELECT b.id, b.total_amount FROM public.bookings b
    WHERE b.basket_id = p_basket_id AND b.status = 'pending' AND b.hold_expires_at = 'infinity'
      AND EXISTS (SELECT 1 FROM public.payments p WHERE p.booking_id = b.id AND p.payment_method = 'gcash'
                  AND p.status = 'pending' AND p.gcash_submitted_at IS NOT NULL)
    ORDER BY b.court_id FOR UPDATE
  ) b;
  IF v_ids IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: No submitted GCash bookings in this basket' USING ERRCODE = 'P0001';
  END IF;
  PERFORM 1 FROM public.payments WHERE booking_id = ANY (v_ids) ORDER BY booking_id FOR UPDATE;

  -- Deliberately no start-time or hold-expiry check: the customer already paid.
  UPDATE public.payments SET status = 'paid', paid_at = now() WHERE booking_id = ANY (v_ids);
  UPDATE public.bookings SET status = 'confirmed', hold_expires_at = NULL, updated_at = now() WHERE id = ANY (v_ids);

  RETURN jsonb_build_object('basket_id', p_basket_id, 'approved', cardinality(v_ids), 'amount', v_amount);
END;
$$;


--
-- Name: block_closed_date_booking(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.block_closed_date_booking() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.venue_closures WHERE closed_on = NEW.booking_date)
     AND NOT (auth.role() IS NULL OR auth.role() = 'service_role' OR public.is_admin()) THEN
    RAISE EXCEPTION 'VENUE_CLOSED' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: booking_event_actor(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.booking_event_actor() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT id FROM public.profiles WHERE id = auth.uid();
$$;


--
-- Name: bookings_basket_id_immutable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.bookings_basket_id_immutable() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF NOT (coalesce(auth.role(), '') = 'service_role' OR (session_user = 'postgres' AND auth.role() IS NULL)) THEN
    RAISE EXCEPTION 'FORBIDDEN: basket_id cannot be changed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: cancel_expired_booking(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cancel_expired_booking(p_booking_id uuid, p_payment_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_booking record;
  v_payment record;
  v_now timestamptz := clock_timestamp();
BEGIN
  -- 0. Authorization check: strictly require service_role
  IF coalesce(auth.role(), '') != 'service_role' AND (session_user != 'postgres' OR auth.role() IS NOT NULL) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Service role required' USING ERRCODE = '42501';
  END IF;

  -- 1. Lock bookings row (Hierarchy Level 1)
  SELECT id, status, hold_expires_at, created_at
  INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('cancelled', false, 'reason', 'BOOKING_NOT_FOUND');
  END IF;

  IF v_booking.status != 'pending' THEN
    RETURN jsonb_build_object('cancelled', false, 'reason', 'BOOKING_NOT_PENDING', 'status', v_booking.status);
  END IF;

  -- 2. Verify hold has actually expired before permitting cancellation
  IF coalesce(v_booking.hold_expires_at, v_booking.created_at + interval '35 minutes') > v_now THEN
    RETURN jsonb_build_object('cancelled', false, 'reason', 'HOLD_NOT_EXPIRED', 'hold_expires_at', v_booking.hold_expires_at);
  END IF;

  -- 3. Payment safety guard: refuse cancellation if ANY payment for this booking is settled or marked paid
  IF EXISTS (
    SELECT 1 FROM public.payments
    WHERE booking_id = p_booking_id
      AND (
        status IN ('paid', 'succeeded', 'refunded')
        OR paid_at IS NOT NULL
      )
  ) THEN
    RETURN jsonb_build_object('cancelled', false, 'reason', 'PAYMENT_ALREADY_SETTLED');
  END IF;

  -- 4. Refund ledger safety guard: refuse cancellation if an active/pending refund exists
  IF EXISTS (
    SELECT 1 FROM public.refund_requests
    WHERE booking_id = p_booking_id
      AND status IN ('pending', 'processing', 'succeeded', 'pending_cash_handover', 'cash_refunded', 'requires_admin_review')
  ) THEN
    RETURN jsonb_build_object('cancelled', false, 'reason', 'REFUND_IN_PROGRESS');
  END IF;

  -- 5. Lock and update payments row (Hierarchy Level 3)
  IF p_payment_id IS NOT NULL THEN
    SELECT id, status
    INTO v_payment
    FROM public.payments
    WHERE id = p_payment_id AND booking_id = p_booking_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('cancelled', false, 'reason', 'PAYMENT_NOT_FOUND');
    END IF;

    IF v_payment.status = 'pending' THEN
      UPDATE public.payments 
      SET status = 'failed' 
      WHERE id = p_payment_id;
    END IF;
  ELSE
    -- If p_payment_id is omitted or NULL, mark any orphaned pending payments as failed
    UPDATE public.payments
    SET status = 'failed'
    WHERE booking_id = p_booking_id AND status = 'pending';
  END IF;

  -- 6. Atomic cancellation of the booking
  UPDATE public.bookings 
  SET status = 'cancelled',
      cancel_reason = 'expired',
      updated_at = v_now 
  WHERE id = p_booking_id;

  RETURN jsonb_build_object('cancelled', true, 'booking_id', p_booking_id, 'payment_id', p_payment_id);
END;
$$;


--
-- Name: cancel_open_play_session(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cancel_open_play_session(p_session_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_ids uuid[];
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN: Admin privileges required' USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM public.open_play_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Session does not exist' USING ERRCODE = 'P0002';
  END IF;

  -- Lock the spot rows so a concurrent GCash proof submit can't slip in between the check and the update
  PERFORM 1 FROM public.bookings WHERE open_play_session_id = p_session_id AND court_id IS NULL FOR UPDATE;

  IF EXISTS (
    SELECT 1 FROM public.bookings
    WHERE open_play_session_id = p_session_id AND status = 'pending' AND hold_expires_at = 'infinity'
  ) THEN
    RAISE EXCEPTION 'GCASH_PENDING_VERIFICATION: Verify or reject the waiting GCash payments first' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.open_play_sessions SET status = 'cancelled' WHERE id = p_session_id;

  WITH c AS (
    UPDATE public.bookings
    SET status = 'cancelled', cancel_reason = 'admin', hold_expires_at = NULL, updated_at = clock_timestamp()
    WHERE open_play_session_id = p_session_id AND status != 'cancelled'
    RETURNING id, court_id
  ), p AS (
    UPDATE public.payments SET status = 'failed'
    WHERE status = 'pending' AND booking_id IN (SELECT id FROM c)
  )
  SELECT coalesce(array_agg(id) FILTER (WHERE court_id IS NULL), '{}') INTO v_ids FROM c;

  RETURN jsonb_build_object('cancelled', cardinality(v_ids), 'booking_ids', to_jsonb(v_ids));
END;
$$;


--
-- Name: check_rate_limit(text, integer, integer, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_rate_limit(p_key text, p_limit integer, p_window_seconds integer, p_increment boolean DEFAULT true) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_window interval := make_interval(secs => p_window_seconds);
  v_row public.auth_rate_limits;
  v_allowed boolean;
BEGIN
  IF coalesce(auth.role(), '') != 'service_role' AND (session_user != 'postgres' OR auth.role() IS NOT NULL) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Service role required' USING ERRCODE = '42501';
  END IF;
  IF p_key IS NULL OR trim(p_key) = '' OR p_limit < 1 OR p_window_seconds < 1 THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: key, limit and window are required' USING ERRCODE = '22000';
  END IF;

  IF p_increment THEN
    -- Single statement, so concurrent requests for the same key cannot both slip under the limit
    INSERT INTO public.auth_rate_limits AS r (key, window_start, count)
    VALUES (p_key, v_now, 1)
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN r.window_start <= v_now - v_window THEN 1 ELSE r.count + 1 END,
      window_start = CASE WHEN r.window_start <= v_now - v_window THEN v_now ELSE r.window_start END
    RETURNING * INTO v_row;
    v_allowed := v_row.count <= p_limit;
  ELSE
    SELECT * INTO v_row FROM public.auth_rate_limits WHERE key = p_key;
    IF NOT FOUND OR v_row.window_start <= v_now - v_window THEN
      RETURN jsonb_build_object('allowed', true, 'count', 0, 'retry_after_seconds', 0);
    END IF;
    v_allowed := v_row.count < p_limit;
  END IF;

  RETURN jsonb_build_object(
    'allowed', v_allowed,
    'count', v_row.count,
    'retry_after_seconds', CASE WHEN v_allowed THEN 0
      ELSE greatest(1, ceil(extract(epoch FROM (v_row.window_start + v_window - v_now))))::integer END
  );
END;
$$;


--
-- Name: claim_pending_refund_request(text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_pending_refund_request(p_worker_id text, p_lease_seconds integer DEFAULT 60) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_claimed record;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF coalesce(auth.role(), '') != 'service_role' AND (session_user != 'postgres' OR auth.role() IS NOT NULL) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Service role required' USING ERRCODE = '42501';
  END IF;

  IF p_worker_id IS NULL OR trim(p_worker_id) = '' THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: p_worker_id cannot be empty' USING ERRCODE = '22000';
  END IF;

  IF p_lease_seconds IS NULL OR p_lease_seconds < 10 OR p_lease_seconds > 300 THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: p_lease_seconds must be between 10 and 300' USING ERRCODE = '22000';
  END IF;

  -- Escalate expired leases that reached retry limit to requires_admin_review (preserves refund capacity)
  UPDATE public.refund_requests
  SET status = 'requires_admin_review',
      error_message = 'Exceeded maximum worker lease attempts (5)',
      updated_at = v_now
  WHERE status = 'processing' 
    AND lease_timeout_at < v_now 
    AND retry_count >= 5;

  -- Claim next available job
  UPDATE public.refund_requests
  SET locked_at = v_now,
      locked_by = trim(p_worker_id),
      lease_timeout_at = v_now + (p_lease_seconds || ' seconds')::interval,
      status = 'processing',
      retry_count = retry_count + 1,
      updated_at = v_now
  WHERE id = (
    SELECT id
    FROM public.refund_requests
    WHERE (status = 'pending' AND (locked_at IS NULL OR lease_timeout_at < v_now))
       OR (status = 'processing' AND lease_timeout_at < v_now AND retry_count < 5)
    ORDER BY created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  RETURNING * INTO v_claimed;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('claimed', false);
  END IF;

  RETURN jsonb_build_object(
    'claimed', true,
    'refund_request', row_to_json(v_claimed)
  );
END;
$$;


--
-- Name: confirm_checkout_hold(uuid, uuid, text, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.confirm_checkout_hold(p_booking_id uuid, p_payment_id uuid, p_stripe_session_id text, p_hold_expires_at timestamp with time zone) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_is_service_role boolean;
  v_court_id uuid;
  v_booking_date date;
  v_start_time time;
  v_end_time time;
  v_user_id uuid;
  v_status text;
  v_court_status text;
  v_conflict_id uuid;
  v_payment_status text;
  v_hold_expires_at timestamptz;
  v_payment_method text;
  v_session_id uuid;
  v_spots int;
  v_session_status text;
  v_capacity int;
BEGIN
  -- 1. Input validation (trust boundary)
  IF p_stripe_session_id IS NULL OR trim(p_stripe_session_id) = '' THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: p_stripe_session_id cannot be empty' USING ERRCODE = '22000';
  END IF;

  IF p_hold_expires_at IS NULL OR p_hold_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: p_hold_expires_at must be in the future' USING ERRCODE = '22000';
  END IF;

  -- 2. Authorization: allow signed service_role JWTs or console psql
  v_is_service_role := (
    coalesce(auth.role(), '') = 'service_role'
    OR (session_user = 'postgres' AND auth.role() IS NULL)
  );

  -- 3. Lock target booking row and verify caller ownership (Hierarchy Level 1)
  SELECT court_id, booking_date, start_time, end_time, user_id, status, hold_expires_at, open_play_session_id, open_play_spots
  INTO v_court_id, v_booking_date, v_start_time, v_end_time, v_user_id, v_status, v_hold_expires_at, v_session_id, v_spots
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Booking does not exist' USING ERRCODE = 'P0002';
  END IF;

  IF NOT v_is_service_role THEN
    IF auth.uid() IS NULL OR coalesce(auth.role(), '') != 'authenticated' THEN
      RAISE EXCEPTION 'UNAUTHORIZED: Authentication required to confirm hold' USING ERRCODE = '42501';
    END IF;
    IF v_user_id != auth.uid() THEN
      RAISE EXCEPTION 'FORBIDDEN: Cannot confirm hold for another user' USING ERRCODE = '42501';
    END IF;
    -- Customers cannot extend their own hold indefinitely
    p_hold_expires_at := least(p_hold_expires_at, clock_timestamp() + interval '40 minutes');
  END IF;

  IF v_status != 'pending' THEN
    RAISE EXCEPTION 'INVALID_STATUS: Booking is not pending (status: %)', v_status USING ERRCODE = '22000';
  END IF;

  IF v_hold_expires_at = 'infinity' THEN
    RAISE EXCEPTION 'INVALID_STATUS: GCash payment is awaiting verification' USING ERRCODE = '22000';
  END IF;

  IF v_court_id IS NULL THEN
    -- Open play spot hold: the session row is the lock, and its capacity replaces the court overlap check
    SELECT status, capacity INTO v_session_status, v_capacity
    FROM public.open_play_sessions
    WHERE id = v_session_id
    FOR UPDATE;

    IF NOT FOUND OR v_session_status != 'open' THEN
      RAISE EXCEPTION 'SESSION_UNAVAILABLE' USING ERRCODE = 'P0001';
    END IF;

    IF public.open_play_spots_taken(v_session_id, p_booking_id) + v_spots > v_capacity THEN
      RAISE EXCEPTION 'SESSION_FULL' USING ERRCODE = 'P0001';
    END IF;
  ELSE
  -- 4. Lock court row to serialize against all concurrent reservations on this court (Hierarchy Level 2)
  SELECT status INTO v_court_status
  FROM public.courts
  WHERE id = v_court_id
  FOR UPDATE;

  IF NOT FOUND OR lower(coalesce(v_court_status, '')) != 'active' THEN
    RAISE EXCEPTION 'COURT_UNAVAILABLE: Court is currently not available' USING ERRCODE = 'P0001';
  END IF;

  -- 5. Check for overlapping reservations (prevents resurrecting hold if slot was claimed after initial hold expired)
  SELECT id INTO v_conflict_id
  FROM public.bookings
  WHERE court_id = v_court_id
    AND booking_date = v_booking_date
    AND id != p_booking_id
    AND (
      status IN ('confirmed', 'checked_in', 'in_progress', 'completed')
      OR (
        status = 'pending'
        AND public.hold_release_after(hold_expires_at, created_at) > clock_timestamp()
      )
    )
    AND start_time < v_end_time
    AND end_time > v_start_time
  LIMIT 1;

  IF v_conflict_id IS NOT NULL THEN
    RAISE EXCEPTION 'SLOT_UNAVAILABLE' USING ERRCODE = 'P0001';
  END IF;
  END IF;

  -- 6. Lock and validate target payment row (Hierarchy Level 3)
  SELECT status, payment_method INTO v_payment_status, v_payment_method
  FROM public.payments
  WHERE id = p_payment_id AND booking_id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Payment % does not exist for booking %', p_payment_id, p_booking_id USING ERRCODE = 'P0002';
  END IF;

  IF v_payment_status != 'pending' THEN
    RAISE EXCEPTION 'INVALID_STATUS: Payment is not pending (status: %)', v_payment_status USING ERRCODE = '22000';
  END IF;

  IF v_payment_method = 'gcash' THEN
    RAISE EXCEPTION 'INVALID_STATUS: GCash payments are not confirmed through Stripe checkout' USING ERRCODE = '22000';
  END IF;

  -- 7. Atomically update hold expiry and stripe_session_id in the same database transaction
  UPDATE public.bookings
  SET hold_expires_at = p_hold_expires_at,
      updated_at = clock_timestamp()
  WHERE id = p_booking_id;

  UPDATE public.payments
  SET stripe_session_id = p_stripe_session_id
  WHERE id = p_payment_id;

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', p_booking_id,
    'payment_id', p_payment_id,
    'hold_expires_at', p_hold_expires_at
  );
END;
$$;


--
-- Name: confirm_manual_cash_refund(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.confirm_manual_cash_refund(p_refund_request_id uuid, p_receipt_reference text, p_notes text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_admin_id uuid;
  v_refund_req record;
  v_payment record;
  v_total_refunded numeric;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required' USING ERRCODE = '42501';
  END IF;
  SELECT id INTO v_admin_id FROM public.profiles WHERE id = auth.uid() AND role = 'admin';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FORBIDDEN: Admin privileges required' USING ERRCODE = '42501';
  END IF;

  IF p_receipt_reference IS NULL OR trim(p_receipt_reference) = '' THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Receipt reference cannot be empty' USING ERRCODE = '22000';
  END IF;

  -- Lock payments (Hierarchy Level 3)
  SELECT p.* INTO v_payment
  FROM public.payments p
  JOIN public.refund_requests r ON r.payment_id = p.id
  WHERE r.id = p_refund_request_id
  FOR UPDATE OF p;

  -- Lock refund_requests (Hierarchy Level 4)
  SELECT * INTO v_refund_req
  FROM public.refund_requests
  WHERE id = p_refund_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Refund request does not exist' USING ERRCODE = 'P0002';
  END IF;

  IF v_refund_req.status = 'cash_refunded' THEN
    RETURN jsonb_build_object('success', true, 'status', 'cash_refunded', 'idempotent', true);
  END IF;

  IF v_refund_req.status != 'pending_cash_handover' THEN
    RAISE EXCEPTION 'INVALID_STATUS: Refund request is in status %, expected pending_cash_handover', v_refund_req.status USING ERRCODE = '22000';
  END IF;

  UPDATE public.refund_requests
  SET status = 'cash_refunded',
      receipt_reference = trim(p_receipt_reference),
      cash_handover_notes = p_notes,
      confirmed_by = v_admin_id,
      handover_confirmed_at = v_now,
      processed_at = v_now,
      updated_at = v_now
  WHERE id = p_refund_request_id;

  SELECT coalesce(sum(amount), 0) INTO v_total_refunded
  FROM public.refund_requests
  WHERE payment_id = v_payment.id AND status = 'cash_refunded';

  IF v_total_refunded = v_payment.amount THEN
    UPDATE public.payments SET status = 'refunded' WHERE id = v_payment.id;
  END IF;

  RETURN jsonb_build_object('success', true, 'status', 'cash_refunded', 'payment_status', CASE WHEN v_total_refunded = v_payment.amount THEN 'refunded' ELSE v_payment.status END);
END;
$$;


--
-- Name: create_walk_in_booking(uuid, text, date, time without time zone, time without time zone, numeric, uuid, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_walk_in_booking(p_court_id uuid, p_customer_name text, p_booking_date date, p_start_time time without time zone, p_end_time time without time zone, p_amount numeric, p_customer_id uuid DEFAULT NULL::uuid, p_user_id uuid DEFAULT NULL::uuid, p_payment_method text DEFAULT NULL::text, p_payment_reference text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
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
  v_min_hours integer;
  v_max_hours integer;
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
  SELECT min_hours, max_hours INTO v_min_hours, v_max_hours FROM public.booking_settings WHERE id;
  IF v_min_hours IS NULL THEN
    RAISE EXCEPTION 'PRICING_NOT_CONFIGURED: booking_settings row is missing' USING ERRCODE = 'P0001';
  END IF;
  IF v_duration_hours < v_min_hours OR v_duration_hours > v_max_hours OR (p_end_time - p_start_time) != (v_duration_hours || ' hours')::interval THEN
    RAISE EXCEPTION 'INVALID_DURATION: Booking duration must be between % and % consecutive hours', v_min_hours, v_max_hours USING ERRCODE = '22000';
  END IF;

  v_expected_amount := public.quote_court_price(p_booking_date, p_start_time, p_end_time);
  IF p_amount IS NOT NULL AND p_amount != v_expected_amount THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: Expected amount of % PHP for % hour(s), but received % PHP', v_expected_amount, v_duration_hours, p_amount USING ERRCODE = '22000';
  END IF;
  p_amount := v_expected_amount;

  -- 3. A slot that has already ended can only be recorded for today (cash taken before staff logged it);
  --    earlier days stay closed so nothing is backdated
  v_now_manila := timezone('Asia/Manila', now());
  IF (p_booking_date + p_end_time) <= v_now_manila AND p_booking_date <> v_now_manila::date THEN
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

  -- Expired holds still match the no_overlapping_active_court_bookings constraint; release them first
  PERFORM public.release_expired_court_holds(p_court_id, p_booking_date, p_start_time, p_end_time);

  -- 6. Check for overlapping active reservations (expired holds past their grace period do NOT conflict)
  SELECT id INTO v_conflict_id
  FROM public.bookings
  WHERE court_id = p_court_id
    AND booking_date = p_booking_date
    AND (
      status IN ('confirmed', 'checked_in', 'in_progress', 'completed')
      OR (
        status = 'pending'
        AND public.hold_release_after(hold_expires_at, created_at) > clock_timestamp()
      )
    )
    AND start_time < p_end_time
    AND end_time > p_start_time
  LIMIT 1;

  IF v_conflict_id IS NOT NULL THEN
    RAISE EXCEPTION 'SLOT_UNAVAILABLE' USING ERRCODE = 'P0001';
  END IF;

  -- 7. Insert the booking (confirmed, or completed when the slot already ended today)
  BEGIN
    INSERT INTO public.bookings (
      user_id,
      customer_id,
      customer_name,
      court_id,
      booking_date,
      start_time,
      end_time,
      status,
      completed_at,
      total_amount
    ) VALUES (
      p_user_id,
      p_customer_id,
      trim(p_customer_name),
      p_court_id,
      p_booking_date,
      p_start_time,
      p_end_time,
      -- Already played today: record it as completed, or the end-of-slot cron would mark it a no-show
      CASE WHEN (p_booking_date + p_end_time) <= v_now_manila THEN 'completed' ELSE 'confirmed' END,
      CASE WHEN (p_booking_date + p_end_time) <= v_now_manila THEN now() ELSE NULL END,
      p_amount
    ) RETURNING id INTO v_booking_id;
  EXCEPTION WHEN exclusion_violation THEN
    RAISE EXCEPTION 'SLOT_UNAVAILABLE' USING ERRCODE = 'P0001';
  END;

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

  RETURN jsonb_build_object('booking_id', v_booking_id, 'amount', p_amount);
END;
$$;


--
-- Name: generate_open_play_sessions(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_open_play_sessions(p_days integer DEFAULT 28) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Manila')::date;
  r record;
  v_dow text;
  v_open boolean;
  v_from time;
  v_to time;
  v_reason text;
  v_created int := 0;
  v_flagged int := 0;
BEGIN
  IF NOT (coalesce(auth.role(), '') = 'service_role' OR public.is_admin()) THEN
    RAISE EXCEPTION 'FORBIDDEN: Admin privileges required' USING ERRCODE = '42501';
  END IF;

  FOR r IN
    SELECT sc.*, d::date AS d
    FROM public.open_play_schedules sc
    CROSS JOIN generate_series(v_today, v_today + (p_days - 1), interval '1 day') d
    LEFT JOIN public.open_play_sessions se ON se.schedule_id = sc.id AND se.session_date = d::date
    WHERE sc.active
      AND (se.id IS NULL OR se.status = 'flagged')
      AND CASE date_part('dow', d)::integer
        WHEN 0 THEN 'Sunday' WHEN 1 THEN 'Monday' WHEN 2 THEN 'Tuesday' WHEN 3 THEN 'Wednesday'
        WHEN 4 THEN 'Thursday' WHEN 5 THEN 'Friday' WHEN 6 THEN 'Saturday'
      END = sc.day_of_week
    ORDER BY d, sc.id
  LOOP
    v_reason := NULL;

    SELECT is_open, open_time, close_time INTO v_open, v_from, v_to
    FROM public.operating_hours WHERE day_of_week = r.day_of_week;
    IF NOT coalesce(v_open, false) OR v_from IS NULL OR v_to IS NULL
       OR r.start_time < v_from OR r.end_time > v_to THEN
      v_reason := 'Venue closed';
    END IF;

    IF v_reason IS NULL THEN
      SELECT 'Court ' || name || ' is ' || status INTO v_reason
      FROM public.courts WHERE id = ANY (r.court_ids) AND status <> 'active'
      ORDER BY name LIMIT 1;
    END IF;

    IF v_reason IS NULL AND (SELECT count(*) FROM public.courts WHERE id = ANY (r.court_ids)) < cardinality(r.court_ids) THEN
      v_reason := 'A court no longer exists';
    END IF;

    IF v_reason IS NULL THEN
      BEGIN
        INSERT INTO public.open_play_sessions (schedule_id, session_date, start_time, end_time, court_ids, capacity, price_per_spot, status)
        VALUES (r.id, r.d, r.start_time, r.end_time, r.court_ids, r.capacity, r.price_per_spot, 'open')
        ON CONFLICT (schedule_id, session_date) DO UPDATE
          SET status = 'open', flag_reason = NULL, start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time,
              court_ids = EXCLUDED.court_ids, capacity = EXCLUDED.capacity, price_per_spot = EXCLUDED.price_per_spot;

        INSERT INTO public.bookings (court_id, open_play_session_id, booking_date, start_time, end_time, status, total_amount, customer_name)
        SELECT c, (SELECT id FROM public.open_play_sessions WHERE schedule_id = r.id AND session_date = r.d),
               r.d, r.start_time, r.end_time, 'confirmed', 0, 'Open play'
        FROM unnest(r.court_ids) c;
        v_created := v_created + 1;
        CONTINUE;
      EXCEPTION WHEN exclusion_violation THEN
        SELECT 'Court ' || c.name || ' already booked '
               || to_char(b.start_time, 'FMHH12:MI AM') || '–' || to_char(b.end_time, 'FMHH12:MI AM')
        INTO v_reason
        FROM public.bookings b JOIN public.courts c ON c.id = b.court_id
        WHERE b.court_id = ANY (r.court_ids) AND b.booking_date = r.d
          AND b.status IN ('confirmed', 'checked_in', 'in_progress', 'completed', 'pending')
          AND b.start_time < r.end_time AND b.end_time > r.start_time
        ORDER BY b.start_time LIMIT 1;
        v_reason := coalesce(v_reason, 'Court already booked');
      END;
    END IF;

    INSERT INTO public.open_play_sessions (schedule_id, session_date, start_time, end_time, court_ids, capacity, price_per_spot, status, flag_reason)
    VALUES (r.id, r.d, r.start_time, r.end_time, r.court_ids, r.capacity, r.price_per_spot, 'flagged', v_reason)
    ON CONFLICT (schedule_id, session_date) DO UPDATE SET flag_reason = EXCLUDED.flag_reason;
    v_flagged := v_flagged + 1;
  END LOOP;

  RETURN jsonb_build_object('created', v_created, 'flagged', v_flagged);
END;
$$;


--
-- Name: get_my_refund_states(uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_refund_states(p_booking_ids uuid[]) RETURNS TABLE(booking_id uuid, status text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT DISTINCT ON (r.booking_id) r.booking_id, r.status
  FROM public.refund_requests r
  JOIN public.bookings b ON b.id = r.booking_id
  WHERE r.booking_id = ANY (p_booking_ids) AND b.user_id = auth.uid()
  ORDER BY r.booking_id, r.created_at DESC;
$$;


--
-- Name: get_open_play_sessions(date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_open_play_sessions(p_from date, p_to date) RETURNS TABLE(id uuid, session_date date, start_time time without time zone, end_time time without time zone, court_names text[], capacity integer, spots_left integer, price_per_spot numeric, my_spots integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT s.id, s.session_date, s.start_time, s.end_time,
    ARRAY(SELECT c.name FROM public.courts c WHERE c.id = ANY (s.court_ids) ORDER BY c.name),
    s.capacity,
    greatest(s.capacity - public.open_play_spots_taken(s.id), 0),
    s.price_per_spot,
    CASE WHEN auth.uid() IS NULL THEN 0 ELSE public.open_play_player_spots(s.id, auth.uid(), NULL) END
  FROM public.open_play_sessions s
  WHERE s.status = 'open'
    AND s.session_date BETWEEN p_from AND p_to
    AND (s.session_date + s.start_time) > timezone('Asia/Manila', now())
    AND NOT EXISTS (SELECT 1 FROM public.venue_closures v WHERE v.closed_on = s.session_date)
  ORDER BY s.session_date, s.start_time;
$$;


--
-- Name: get_public_slot_availability(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_public_slot_availability(p_booking_date date) RETURNS TABLE(id uuid, user_id uuid, court_id uuid, start_time time without time zone, end_time time without time zone, status text, hold_expires_at timestamp with time zone, open_play boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
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
$$;


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
    INSERT INTO public.profiles (
        id,
        email,
        full_name,
        phone,
        role
    )
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(
            NULLIF(NEW.raw_user_meta_data ->> 'full_name', ''),
            NULLIF(NEW.raw_user_meta_data ->> 'name', '')
        ),
        COALESCE(NEW.raw_user_meta_data ->> 'phone', ''),
        'customer'
    )
    ON CONFLICT (id) DO NOTHING;

    RETURN NEW;
END;
$$;


--
-- Name: hold_court_basket(date, jsonb, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.hold_court_basket(p_booking_date date, p_lines jsonb, p_hold_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_basket uuid := gen_random_uuid();
  v_line record;
  v_hold jsonb;
  v_items jsonb := '[]'::jsonb;
  v_total numeric := 0;
  v_expires timestamptz;
BEGIN
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_lines) = 0
     OR jsonb_array_length(p_lines) > (SELECT count(*) FROM public.courts) THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: p_lines must list between 1 and the number of courts' USING ERRCODE = '22000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_lines) e
    WHERE jsonb_typeof(e) != 'object' OR e->>'court_id' IS NULL OR e->>'start_time' IS NULL OR e->>'end_time' IS NULL
  ) THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Each line needs court_id, start_time and end_time' USING ERRCODE = '22000';
  END IF;
  IF (SELECT count(DISTINCT (e->>'court_id')::uuid) FROM jsonb_array_elements(p_lines) e) < jsonb_array_length(p_lines) THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Each court can appear once per booking' USING ERRCODE = '22000';
  END IF;

  -- Lets hold_court_booking accept v_basket for this transaction only (see its p_basket_id guard)
  PERFORM set_config('app.hold_basket_id', v_basket::text, true);

  -- Court order gives every basket the same court-row lock order, so overlapping baskets cannot deadlock
  FOR v_line IN
    SELECT (e->>'court_id')::uuid AS court_id, (e->>'start_time')::time AS start_time, (e->>'end_time')::time AS end_time, c.name AS court_name
    FROM jsonb_array_elements(p_lines) e
    LEFT JOIN public.courts c ON c.id = (e->>'court_id')::uuid
    ORDER BY 1
  LOOP
    BEGIN
      v_hold := public.hold_court_booking(
        p_court_id => v_line.court_id, p_booking_date => p_booking_date,
        p_start_time => v_line.start_time, p_end_time => v_line.end_time,
        p_user_id => auth.uid(), p_amount => NULL,
        p_hold_expires_at => p_hold_expires_at, p_basket_id => v_basket
      );
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM = 'SLOT_UNAVAILABLE' THEN
        RAISE EXCEPTION 'SLOT_UNAVAILABLE: % %–%', v_line.court_name,
          to_char(v_line.start_time, 'HH:MI AM'), to_char(v_line.end_time, 'HH:MI AM') USING ERRCODE = 'P0001';
      END IF;
      RAISE;
    END;

    v_total := v_total + (v_hold->>'amount')::numeric;
    v_expires := least(v_expires, (v_hold->>'hold_expires_at')::timestamptz);
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'booking_id', v_hold->'booking_id',
      'payment_id', v_hold->'payment_id',
      'court_id', v_line.court_id,
      'court_name', v_line.court_name,
      'start_time', v_line.start_time,
      'end_time', v_line.end_time,
      'amount', v_hold->'amount'
    ));
  END LOOP;

  PERFORM set_config('app.hold_basket_id', '', true);
  RETURN jsonb_build_object('basket_id', v_basket, 'hold_expires_at', v_expires, 'total', v_total, 'items', v_items);
END;
$$;


--
-- Name: hold_court_booking(uuid, date, time without time zone, time without time zone, uuid, numeric, timestamp with time zone, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.hold_court_booking(p_court_id uuid, p_booking_date date, p_start_time time without time zone, p_end_time time without time zone, p_user_id uuid, p_amount numeric, p_hold_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_basket_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_is_service_role boolean;
  v_court_status text;
  v_conflict_id uuid;
  v_booking_id uuid;
  v_basket_id uuid;
  v_payment_id uuid;
  v_customer_name text;
  v_now_manila timestamp;
  v_day_of_week text;
  v_is_open boolean;
  v_open_time time;
  v_close_time time;
  v_duration_hours integer;
  v_expected_amount numeric;
  v_min_hours integer;
  v_max_hours integer;
  v_hold_expires_at timestamptz;
BEGIN
  -- 1. Evaluate caller authorization: allow signed service_role JWTs or raw console psql sessions without JWT
  v_is_service_role := (
    coalesce(auth.role(), '') = 'service_role'
    OR (session_user = 'postgres' AND auth.role() IS NULL)
  );

  -- Non-service-role callers MUST be authenticated and can only hold a slot for themselves
  IF NOT v_is_service_role THEN
    IF auth.uid() IS NULL OR coalesce(auth.role(), '') != 'authenticated' THEN
      RAISE EXCEPTION 'UNAUTHORIZED: Authentication required to reserve a court' USING ERRCODE = '42501';
    END IF;
    IF p_user_id IS NOT NULL AND p_user_id != auth.uid() THEN
      RAISE EXCEPTION 'FORBIDDEN: Cannot hold court on behalf of another player' USING ERRCODE = '42501';
    END IF;
    p_user_id := auth.uid();
  ELSE
    IF p_user_id IS NULL THEN
      RAISE EXCEPTION 'INVALID_ARGUMENT: p_user_id is required' USING ERRCODE = '22000';
    END IF;
  END IF;

  -- 2. Validate time boundaries and whole-hour increments
  IF p_start_time >= p_end_time THEN
    RAISE EXCEPTION 'INVALID_TIME_RANGE: start_time must be earlier than end_time' USING ERRCODE = '22000';
  END IF;

  IF date_part('minute', p_start_time) != 0 
     OR date_part('second', p_start_time) != 0 
     OR date_part('minute', p_end_time) != 0 
     OR date_part('second', p_end_time) != 0 THEN
    RAISE EXCEPTION 'INVALID_TIME_INCREMENT: Reservations must be booked in whole-hour increments on the hour' USING ERRCODE = '22000';
  END IF;

  -- 3. Validate duration (1 to 3 whole hours)
  v_duration_hours := (date_part('epoch', (p_end_time - p_start_time)) / 3600)::integer;
  SELECT min_hours, max_hours INTO v_min_hours, v_max_hours FROM public.booking_settings WHERE id;
  IF v_min_hours IS NULL THEN
    RAISE EXCEPTION 'PRICING_NOT_CONFIGURED: booking_settings row is missing' USING ERRCODE = 'P0001';
  END IF;
  IF v_duration_hours < v_min_hours OR v_duration_hours > v_max_hours OR (p_end_time - p_start_time) != (v_duration_hours || ' hours')::interval THEN
    RAISE EXCEPTION 'INVALID_DURATION: Booking duration must be between % and % consecutive hours', v_min_hours, v_max_hours USING ERRCODE = '22000';
  END IF;

  -- 4. Reject past dates and times in Asia/Manila timezone
  v_now_manila := timezone('Asia/Manila', now());
  IF (p_booking_date + p_start_time) <= v_now_manila THEN
    RAISE EXCEPTION 'PAST_SLOT: The requested time slot has already passed' USING ERRCODE = '22000';
  END IF;

  -- 5. Query and verify venue operating hours for the given date
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

  -- 6. Enforce server-calculated price (PHP 200 per hour flat rate; prevents underpayment bypass)
  v_expected_amount := public.quote_court_price(p_booking_date, p_start_time, p_end_time);
  IF p_amount IS NOT NULL AND p_amount != v_expected_amount THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: Expected amount of % PHP for % hour(s), but received % PHP', v_expected_amount, v_duration_hours, p_amount USING ERRCODE = '22000';
  END IF;
  p_amount := v_expected_amount;

  -- 7. Acquire exclusive row lock on the court row and verify operational status
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

  -- 8. Compute or validate hold expiry
  -- If caller did not provide p_hold_expires_at (legacy 6-arg caller), fallback safely to clock_timestamp() + interval '35 minutes'.
  -- This acts as a safety buffer (giving ~2 minutes of headroom beyond Stripe's 33-minute checkout lifetime)
  -- rather than an exact match, guaranteeing the database hold outlasts the Stripe checkout session.
  IF p_hold_expires_at IS NULL THEN
    v_hold_expires_at := clock_timestamp() + interval '35 minutes';
  ELSE
    v_hold_expires_at := p_hold_expires_at;
  END IF;

  -- Customers may not choose a long hold (would block the slot indefinitely) or hoard slots
  IF NOT v_is_service_role THEN
    v_hold_expires_at := least(v_hold_expires_at, clock_timestamp() + interval '40 minutes');

    -- A customer's p_basket_id is honoured only from hold_court_basket in this transaction: adding a court to an
    -- existing basket would put it on that basket's (possibly paid) Stripe session. PostgREST cannot set app.* settings.
    IF p_basket_id IS NOT NULL AND current_setting('app.hold_basket_id', true) IS DISTINCT FROM p_basket_id::text THEN
      RAISE EXCEPTION 'INVALID_ARGUMENT: p_basket_id is only accepted from hold_court_basket' USING ERRCODE = '22000';
    END IF;

    -- It may only extend the caller's own basket, on its date, with a new court
    IF p_basket_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.bookings
      WHERE basket_id = p_basket_id
        AND (user_id IS DISTINCT FROM p_user_id OR booking_date != p_booking_date OR court_id = p_court_id)
    ) THEN
      RAISE EXCEPTION 'INVALID_ARGUMENT: p_basket_id does not match this court, date and customer' USING ERRCODE = '22000';
    END IF;

    -- One open basket per customer; a legacy hold without basket_id is its own basket
    IF EXISTS (
      SELECT 1 FROM public.bookings
      WHERE user_id = p_user_id
        AND status = 'pending'
        AND coalesce(hold_expires_at, created_at + interval '35 minutes') > clock_timestamp()
        AND coalesce(basket_id, id) IS DISTINCT FROM p_basket_id
    ) THEN
      RAISE EXCEPTION 'OPEN_BASKET_EXISTS: Finish or cancel your reservation awaiting payment before starting another' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Expired holds still match the no_overlapping_active_court_bookings constraint; release them first
  PERFORM public.release_expired_court_holds(p_court_id, p_booking_date, p_start_time, p_end_time);

  -- 9. Verify no overlapping active reservation or unexpired pending hold exists on this court and date
  -- Includes checked_in and in_progress to prevent stealing active matches
  -- Expired pending holds stop blocking once their grace period ends (public.hold_release_after)
  SELECT id INTO v_conflict_id
  FROM public.bookings
  WHERE court_id = p_court_id
    AND booking_date = p_booking_date
    AND (
      status IN ('confirmed', 'checked_in', 'in_progress', 'completed')
      OR (
        status = 'pending'
        AND public.hold_release_after(hold_expires_at, created_at) > clock_timestamp()
      )
    )
    AND start_time < p_end_time
    AND end_time > p_start_time
  LIMIT 1;

  IF v_conflict_id IS NOT NULL THEN
    RAISE EXCEPTION 'SLOT_UNAVAILABLE' USING ERRCODE = 'P0001';
  END IF;

  -- 10. Retrieve player's name from profiles to ensure customer_name is populated
  SELECT full_name INTO v_customer_name FROM public.profiles WHERE id = p_user_id;

  -- 11. Create pending booking with explicit hold_expires_at
  BEGIN
    INSERT INTO public.bookings (
      user_id,
      customer_name,
      court_id,
      booking_date,
      start_time,
      end_time,
      status,
      total_amount,
      hold_expires_at,
      basket_id
    ) VALUES (
      p_user_id,
      coalesce(v_customer_name, 'Online Player'),
      p_court_id,
      p_booking_date,
      p_start_time,
      p_end_time,
      'pending',
      p_amount,
      v_hold_expires_at,
      coalesce(p_basket_id, gen_random_uuid())
    ) RETURNING id, basket_id INTO v_booking_id, v_basket_id;
  EXCEPTION WHEN exclusion_violation THEN
    -- e.g. an expired hold that could not be released because it is locked by another transaction
    RAISE EXCEPTION 'SLOT_UNAVAILABLE' USING ERRCODE = 'P0001';
  END;

  -- 12. Create pending payment (if this fails, transaction rolls back booking insert automatically)
  INSERT INTO public.payments (
    booking_id,
    amount,
    currency,
    status
  ) VALUES (
    v_booking_id,
    p_amount,
    'php',
    'pending'
  ) RETURNING id INTO v_payment_id;

  RETURN jsonb_build_object(
    'booking_id', v_booking_id,
    'payment_id', v_payment_id,
    'hold_expires_at', v_hold_expires_at,
    'amount', p_amount,
    'basket_id', v_basket_id
  );
END;
$$;


--
-- Name: hold_gcash_basket(date, jsonb, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.hold_gcash_basket(p_booking_date date, p_lines jsonb, p_hold_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v jsonb;
BEGIN
  IF (SELECT gcash_number FROM public.booking_settings LIMIT 1) IS NULL THEN
    RAISE EXCEPTION 'GCASH_NOT_CONFIGURED: GCash payment is not set up' USING ERRCODE = 'P0001';
  END IF;

  v := public.hold_court_basket(p_booking_date, p_lines, p_hold_expires_at);
  UPDATE public.payments SET payment_method = 'gcash'
  WHERE id IN (SELECT (i->>'payment_id')::uuid FROM jsonb_array_elements(v->'items') i);
  RETURN v;
END;
$$;


--
-- Name: hold_open_play_spots(uuid, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.hold_open_play_spots(p_session_id uuid, p_spots integer, p_payment_method text DEFAULT 'stripe'::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_session record;
  v_name text;
  v_basket uuid := gen_random_uuid();
  v_amount numeric;
  v_booking_id uuid;
  v_payment_id uuid;
  v_expires timestamptz := now() + interval '35 minutes';
BEGIN
  IF v_uid IS NULL OR coalesce(auth.role(), '') != 'authenticated' THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required to hold spots' USING ERRCODE = '42501';
  END IF;
  IF p_spots IS NULL OR p_spots NOT BETWEEN 1 AND 4 OR p_payment_method IS NULL OR p_payment_method NOT IN ('stripe', 'gcash') THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: spots must be 1-4 and method stripe or gcash' USING ERRCODE = '22000';
  END IF;

  SELECT * INTO v_session FROM public.open_play_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Session does not exist' USING ERRCODE = 'P0002';
  END IF;
  IF v_session.status != 'open' OR (v_session.session_date + v_session.start_time) <= timezone('Asia/Manila', now()) THEN
    RAISE EXCEPTION 'SESSION_UNAVAILABLE' USING ERRCODE = 'P0001';
  END IF;

  -- Release this session's stale holds first so their spots count as free
  WITH stale AS (
    UPDATE public.bookings SET status = 'cancelled', cancel_reason = 'expired', updated_at = clock_timestamp()
    WHERE open_play_session_id = p_session_id AND court_id IS NULL AND status = 'pending'
      AND public.hold_release_after(hold_expires_at, created_at) <= clock_timestamp()
    RETURNING id
  )
  UPDATE public.payments SET status = 'failed'
  WHERE status = 'pending' AND booking_id IN (SELECT id FROM stale);

  -- GCash proofs awaiting staff (infinite hold) are paid money, not an abandoned checkout
  IF EXISTS (
    SELECT 1 FROM public.bookings
    WHERE open_play_session_id = p_session_id AND court_id IS NULL AND user_id = v_uid
      AND status = 'pending' AND hold_expires_at IS DISTINCT FROM 'infinity'
  ) THEN
    RAISE EXCEPTION 'OPEN_HOLD_EXISTS' USING ERRCODE = 'P0001';
  END IF;

  IF public.open_play_spots_taken(p_session_id) + p_spots > v_session.capacity THEN
    RAISE EXCEPTION 'SESSION_FULL' USING ERRCODE = 'P0001';
  END IF;
  IF public.open_play_player_spots(p_session_id, v_uid, NULL) + p_spots > 4 THEN
    RAISE EXCEPTION 'PLAYER_LIMIT' USING ERRCODE = 'P0001';
  END IF;

  SELECT nullif(trim(full_name), '') INTO v_name FROM public.profiles WHERE id = v_uid;
  v_amount := p_spots * v_session.price_per_spot;

  INSERT INTO public.bookings (
    user_id, customer_name, open_play_session_id, open_play_spots, booking_date, start_time, end_time,
    status, total_amount, basket_id, hold_expires_at
  ) VALUES (
    v_uid, coalesce(v_name, 'Online Player'), p_session_id, p_spots, v_session.session_date, v_session.start_time, v_session.end_time,
    'pending', v_amount, v_basket, v_expires
  ) RETURNING id INTO v_booking_id;

  INSERT INTO public.payments (booking_id, amount, currency, status, payment_method)
  VALUES (v_booking_id, v_amount, 'php', 'pending', p_payment_method)
  RETURNING id INTO v_payment_id;

  RETURN jsonb_build_object('basket_id', v_basket, 'booking_id', v_booking_id, 'payment_id', v_payment_id,
                            'amount', v_amount, 'hold_expires_at', v_expires);
END;
$$;


--
-- Name: hold_release_after(timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.hold_release_after(p_hold_expires_at timestamp with time zone, p_created_at timestamp with time zone) RETURNS timestamp with time zone
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  SELECT coalesce(p_hold_expires_at, p_created_at + interval '35 minutes') + interval '20 minutes';
$$;


--
-- Name: is_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;


--
-- Name: is_owner(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_owner() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin' AND is_owner);
$$;


--
-- Name: move_booking(uuid, uuid, date, time without time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.move_booking(p_booking_id uuid, p_court_id uuid, p_booking_date date, p_start_time time without time zone) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_now timestamp := timezone('Asia/Manila', now());
  v_end time;
  v_day text;
  v_is_open boolean;
  v_open time;
  v_close time;
  v_court_status text;
  v_conflict uuid;
  v_price numeric;
  v_old_price numeric;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN: Admin privileges required to move bookings' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Booking does not exist' USING ERRCODE = 'P0002';
  END IF;

  -- Only a confirmed court booking that has not started (open play blocks and spots are managed on Open Play)
  IF v_booking.court_id IS NULL OR v_booking.open_play_session_id IS NOT NULL THEN
    RAISE EXCEPTION 'NOT_MOVABLE: Open play is managed on the Open Play page' USING ERRCODE = 'P0001';
  END IF;
  IF v_booking.status <> 'confirmed' THEN
    RAISE EXCEPTION 'NOT_MOVABLE: Only confirmed bookings that have not started can be moved' USING ERRCODE = 'P0001';
  END IF;
  IF (v_booking.booking_date + v_booking.start_time) <= v_now THEN
    RAISE EXCEPTION 'NOT_MOVABLE: This booking has already started' USING ERRCODE = 'P0001';
  END IF;

  IF date_part('minute', p_start_time) <> 0 OR date_part('second', p_start_time) <> 0 THEN
    RAISE EXCEPTION 'INVALID_TIME_INCREMENT: Bookings start on the hour' USING ERRCODE = '22000';
  END IF;

  -- Same length as before; a slot that would run past midnight is outside opening hours
  v_end := p_start_time + (v_booking.end_time - v_booking.start_time);
  IF v_end <= p_start_time THEN
    RAISE EXCEPTION 'OUTSIDE_OPERATING_HOURS: The new time runs past closing' USING ERRCODE = '22000';
  END IF;
  IF (p_booking_date + p_start_time) <= v_now THEN
    RAISE EXCEPTION 'PAST_SLOT: The new time has already started' USING ERRCODE = '22000';
  END IF;
  IF p_court_id = v_booking.court_id AND p_booking_date = v_booking.booking_date AND p_start_time = v_booking.start_time THEN
    RAISE EXCEPTION 'NO_CHANGE: The booking is already at that court and time' USING ERRCODE = '22000';
  END IF;

  v_day := trim(to_char(p_booking_date, 'Day'));
  SELECT is_open, open_time, close_time INTO v_is_open, v_open, v_close
  FROM public.operating_hours WHERE day_of_week = v_day;
  IF NOT FOUND OR NOT v_is_open OR v_open IS NULL OR v_close IS NULL THEN
    RAISE EXCEPTION 'VENUE_CLOSED: The venue is closed on that day' USING ERRCODE = 'P0001';
  END IF;
  IF p_start_time < v_open OR v_end > v_close THEN
    RAISE EXCEPTION 'OUTSIDE_OPERATING_HOURS: The new time is outside opening hours' USING ERRCODE = '22000';
  END IF;

  -- Lock the target court, as walk-ins do, so two moves can't take the same slot
  SELECT status INTO v_court_status FROM public.courts WHERE id = p_court_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Court does not exist' USING ERRCODE = 'P0002';
  END IF;
  IF lower(coalesce(v_court_status, '')) <> 'active' THEN
    RAISE EXCEPTION 'COURT_UNAVAILABLE: That court is closed for maintenance' USING ERRCODE = 'P0001';
  END IF;

  PERFORM public.release_expired_court_holds(p_court_id, p_booking_date, p_start_time, v_end);

  SELECT id INTO v_conflict
  FROM public.bookings
  WHERE court_id = p_court_id
    AND booking_date = p_booking_date
    AND id <> v_booking.id
    AND (
      status IN ('confirmed', 'checked_in', 'in_progress', 'completed')
      OR (status = 'pending' AND public.hold_release_after(hold_expires_at, created_at) > clock_timestamp())
    )
    AND start_time < v_end
    AND end_time > p_start_time
  LIMIT 1;
  IF v_conflict IS NOT NULL THEN
    RAISE EXCEPTION 'SLOT_UNAVAILABLE' USING ERRCODE = 'P0001';
  END IF;

  -- The payment stays as it is, so the move itself must not change the price: both slots are priced on today's
  -- price list (a booking made before a price change keeps what it paid and can still move to an equal slot)
  v_price := public.quote_court_price(p_booking_date, p_start_time, v_end);
  v_old_price := public.quote_court_price(v_booking.booking_date, v_booking.start_time, v_booking.end_time);
  IF v_price <> v_old_price THEN
    RAISE EXCEPTION 'PRICE_CHANGES: %|%', v_old_price, v_price USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    UPDATE public.bookings
    SET court_id = p_court_id, booking_date = p_booking_date, start_time = p_start_time, end_time = v_end, updated_at = now()
    WHERE id = v_booking.id;
  EXCEPTION WHEN exclusion_violation THEN
    RAISE EXCEPTION 'SLOT_UNAVAILABLE' USING ERRCODE = 'P0001';
  END;

  RETURN jsonb_build_object(
    'booking_id', v_booking.id,
    'court_id', p_court_id,
    'booking_date', p_booking_date,
    'start_time', p_start_time,
    'end_time', v_end
  );
END;
$$;


--
-- Name: open_play_player_spots(uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.open_play_player_spots(p_session_id uuid, p_user_id uuid, p_customer_id uuid) RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT coalesce(sum(open_play_spots), 0)::integer FROM public.bookings
  WHERE open_play_session_id = p_session_id AND court_id IS NULL
    AND (user_id = p_user_id OR customer_id = p_customer_id)
    AND (status IN ('confirmed','checked_in','in_progress','completed')
      OR (status = 'pending' AND public.hold_release_after(hold_expires_at, created_at) > clock_timestamp()));
$$;


--
-- Name: open_play_spots_taken(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.open_play_spots_taken(p_session_id uuid, p_exclude_booking uuid DEFAULT NULL::uuid) RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT coalesce(sum(open_play_spots), 0)::integer FROM public.bookings
  WHERE open_play_session_id = p_session_id AND court_id IS NULL
    AND id IS DISTINCT FROM p_exclude_booking
    AND (status IN ('confirmed','checked_in','in_progress','completed')
      OR (status = 'pending' AND public.hold_release_after(hold_expires_at, created_at) > clock_timestamp()));
$$;


--
-- Name: pricing_snapshot(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.pricing_snapshot() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT jsonb_build_object(
    'settings', (SELECT jsonb_build_object('base_hourly_rate', base_hourly_rate, 'min_hours', min_hours, 'max_hours', max_hours)
                 FROM public.booking_settings WHERE id),
    'peakRates', coalesce((SELECT jsonb_agg(jsonb_build_object(
                    'label', label, 'days', to_jsonb(days),
                    'start_time', to_char(start_time, 'HH24:MI'), 'end_time', to_char(end_time, 'HH24:MI'),
                    'hourly_rate', hourly_rate) ORDER BY start_time, label)
                  FROM public.peak_rates), '[]'::jsonb)
  );
$$;


--
-- Name: quote_court_price(date, time without time zone, time without time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.quote_court_price(p_booking_date date, p_start_time time without time zone, p_end_time time without time zone) RETURNS numeric
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
DECLARE
  v_base numeric;
  v_day text := to_char(p_booking_date, 'FMDay');
  v_hours integer := (date_part('epoch', p_end_time - p_start_time) / 3600)::integer;
  v_hour time;
  v_rate numeric;
  v_total numeric := 0;
BEGIN
  SELECT base_hourly_rate INTO v_base FROM public.booking_settings WHERE id;
  IF v_base IS NULL THEN
    RAISE EXCEPTION 'PRICING_NOT_CONFIGURED: booking_settings row is missing' USING ERRCODE = 'P0001';
  END IF;

  FOR i IN 0 .. v_hours - 1 LOOP
    v_hour := p_start_time + make_interval(hours => i);
    SELECT max(hourly_rate) INTO v_rate
    FROM public.peak_rates
    WHERE v_day = ANY (days) AND start_time <= v_hour AND v_hour < end_time;
    v_total := v_total + coalesce(v_rate, v_base);
  END LOOP;

  RETURN v_total;
END;
$$;


--
-- Name: reconcile_booking_payment(uuid, uuid, text, text, numeric, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reconcile_booking_payment(p_booking_id uuid, p_payment_id uuid, p_stripe_session_id text, p_stripe_payment_intent text, p_amount numeric, p_currency text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_booking record;
  v_court record;
  v_payment record;
  v_existing_dup record;
  v_conflict_id uuid;
  v_is_past boolean;
  v_now timestamptz := clock_timestamp();
  v_dup_payment_id uuid;
  v_idempotency_key text;
  v_is_eligible_for_normal_confirm boolean;
  v_diag_constraint text;
  v_refund_res jsonb;
  v_session_status text;
  v_capacity int;
  v_unavailable boolean;
BEGIN
  IF coalesce(auth.role(), '') != 'service_role' AND (session_user != 'postgres' OR auth.role() IS NOT NULL) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Service role required' USING ERRCODE = '42501';
  END IF;

  IF p_stripe_payment_intent IS NULL OR trim(p_stripe_payment_intent) = '' THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: p_stripe_payment_intent cannot be empty' USING ERRCODE = '22000';
  END IF;
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: p_amount must be greater than zero' USING ERRCODE = '22000';
  END IF;

  -- 1. Lock target booking (Hierarchy Level 1)
  SELECT id, court_id, booking_date, start_time, end_time, status, total_amount, user_id, open_play_session_id, open_play_spots
  INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Booking % does not exist', p_booking_id USING ERRCODE = 'P0002';
  END IF;

  -- 2. Lock court (Hierarchy Level 2)
  SELECT id, status INTO v_court
  FROM public.courts
  WHERE id = v_booking.court_id
  FOR UPDATE;

  -- Spot rows have no court: the session row is the lock instead
  IF v_booking.court_id IS NULL THEN
    SELECT status, capacity INTO v_session_status, v_capacity
    FROM public.open_play_sessions
    WHERE id = v_booking.open_play_session_id
    FOR UPDATE;
  END IF;

  -- 3. Lock target payment (Hierarchy Level 3)
  SELECT id, booking_id, amount, currency, status, payment_method, stripe_session_id, stripe_payment_id
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
  IF lower(v_payment.currency) != lower(p_currency) OR v_payment.amount != p_amount THEN
    RAISE EXCEPTION 'MISMATCHED_PAYMENT_DETAILS: Amount or currency mismatch' USING ERRCODE = '22000';
  END IF;

  -- Strict eligibility check for normal confirmation of v_payment
  v_is_eligible_for_normal_confirm := (
    v_payment.status = 'pending'
    AND (v_payment.payment_method IS NULL OR v_payment.payment_method = 'stripe')
    AND (v_payment.stripe_session_id IS NULL OR v_payment.stripe_session_id = p_stripe_session_id)
    AND (v_payment.stripe_payment_id IS NULL OR v_payment.stripe_payment_id = p_stripe_payment_intent)
  );

  -- Branch 1: Target booking already confirmed / active OR v_payment is ineligible for normal confirm
  IF v_booking.status IN ('confirmed', 'checked_in', 'in_progress', 'completed') OR NOT v_is_eligible_for_normal_confirm THEN
    -- Subcase 1.1: Exact redelivery of original Stripe payment (paid or already refunded)
    IF v_payment.status IN ('paid', 'refunded') 
       AND v_payment.stripe_payment_id = p_stripe_payment_intent 
       AND (v_payment.stripe_session_id IS NULL OR v_payment.stripe_session_id = p_stripe_session_id) THEN
      RETURN jsonb_build_object('action', 'NO_OP', 'status', 'ALREADY_CONFIRMED', 'booking_status', v_booking.status);
    END IF;

    -- Subcase 1.2: Legitimate backfill of missing stripe_payment_id on original Stripe session
    IF v_booking.status IN ('confirmed', 'checked_in', 'in_progress', 'completed')
       AND v_payment.status = 'paid' 
       AND v_payment.payment_method = 'stripe' 
       AND v_payment.stripe_session_id = p_stripe_session_id 
       AND v_payment.stripe_payment_id IS NULL THEN
      UPDATE public.payments 
      SET stripe_payment_id = p_stripe_payment_intent 
      WHERE id = v_payment.id;
      RETURN jsonb_build_object('action', 'NO_OP', 'status', 'ALREADY_CONFIRMED_BACKFILLED', 'booking_status', v_booking.status);
    END IF;

    -- Subcase 1.3: Isolated Duplicate Payment Attempt
    SELECT id, booking_id, amount, currency, status, stripe_session_id, stripe_payment_id
    INTO v_existing_dup
    FROM public.payments
    WHERE stripe_payment_id = p_stripe_payment_intent
      AND booking_id = p_booking_id
    FOR UPDATE;

    IF FOUND THEN
      IF v_existing_dup.booking_id != p_booking_id 
         OR v_existing_dup.amount != p_amount 
         OR lower(v_existing_dup.currency) != lower(p_currency)
         OR (v_existing_dup.stripe_session_id IS NOT NULL AND v_existing_dup.stripe_session_id != p_stripe_session_id) THEN
        RAISE EXCEPTION 'AMBIGUOUS_PAYMENT_INTENT_ASSOCIATION: Conflicting metadata for PI %', p_stripe_payment_intent USING ERRCODE = '22000';
      END IF;
      v_dup_payment_id := v_existing_dup.id;
    ELSE
      BEGIN
        INSERT INTO public.payments (
          booking_id, amount, currency, status, payment_method, stripe_session_id, stripe_payment_id, paid_at
        ) VALUES (
          p_booking_id, p_amount, lower(p_currency), 'paid', 'stripe', p_stripe_session_id, p_stripe_payment_intent, v_now
        ) RETURNING id INTO v_dup_payment_id;
      EXCEPTION WHEN unique_violation THEN
        GET STACKED DIAGNOSTICS v_diag_constraint = CONSTRAINT_NAME;
        IF v_diag_constraint IS NOT NULL AND v_diag_constraint != 'uq_payments_intent_per_booking' THEN
          RAISE;
        END IF;

        SELECT id, booking_id, amount, currency, status, stripe_session_id, stripe_payment_id
        INTO v_existing_dup
        FROM public.payments
        WHERE stripe_payment_id = p_stripe_payment_intent
          AND booking_id = p_booking_id
        FOR UPDATE;

        IF NOT FOUND OR v_existing_dup.booking_id != p_booking_id 
           OR v_existing_dup.amount != p_amount 
           OR lower(v_existing_dup.currency) != lower(p_currency)
           OR (v_existing_dup.stripe_session_id IS NOT NULL AND v_existing_dup.stripe_session_id != p_stripe_session_id) THEN
          RAISE EXCEPTION 'AMBIGUOUS_PAYMENT_INTENT_ASSOCIATION: Unique collision metadata check failed for PI %', p_stripe_payment_intent USING ERRCODE = '22000';
        END IF;
        v_dup_payment_id := v_existing_dup.id;
      END;
    END IF;

    v_idempotency_key := 'ref_duplicate_pi_' || p_stripe_payment_intent || '_' || p_booking_id;
    v_refund_res := public.reserve_payment_refund(
      v_dup_payment_id, p_booking_id, p_amount, p_currency, 'stripe', 'DUPLICATE_PAYMENT_REFUND', v_idempotency_key, p_stripe_payment_intent
    );
    RETURN jsonb_build_object('action', 'REFUND_SCHEDULED', 'reason', 'DUPLICATE_PAYMENT', 'payment_id', v_dup_payment_id, 'idempotency_key', v_idempotency_key, 'refund_request_id', v_refund_res->>'refund_request_id');
  END IF;

  -- Branch 2: Court Unavailable (Inactive or Under Maintenance)
  v_unavailable := CASE WHEN v_booking.court_id IS NULL THEN v_session_status IS DISTINCT FROM 'open'
                        ELSE NOT FOUND OR lower(coalesce(v_court.status, '')) != 'active' END;
  IF v_unavailable THEN
    UPDATE public.payments
    SET status = 'paid',
        payment_method = 'stripe',
        stripe_session_id = coalesce(p_stripe_session_id, stripe_session_id),
        stripe_payment_id = p_stripe_payment_intent,
        paid_at = v_now
    WHERE id = p_payment_id;

    UPDATE public.bookings
    SET status = 'cancelled',
        cancel_reason = 'court_unavailable',
        hold_expires_at = NULL,
        updated_at = v_now
    WHERE id = p_booking_id;

    v_idempotency_key := 'ref_court_unavail_' || p_payment_id;
    v_refund_res := public.reserve_payment_refund(
      p_payment_id, p_booking_id, p_amount, p_currency, 'stripe', 'COURT_UNAVAILABLE_REFUND', v_idempotency_key, p_stripe_payment_intent
    );

    RETURN jsonb_build_object(
      'action', 'REFUND_SCHEDULED', 
      'reason', 'COURT_UNAVAILABLE', 
      'payment_id', p_payment_id,
      'idempotency_key', v_idempotency_key,
      'refund_request_id', v_refund_res->>'refund_request_id'
    );
  END IF;

  -- Branch 3: Scheduled match time in Asia/Manila (+08:00) has passed
  v_is_past := ((v_booking.booking_date + v_booking.start_time) AT TIME ZONE 'Asia/Manila') <= v_now;
  IF v_is_past THEN
    UPDATE public.payments
    SET status = 'paid',
        payment_method = 'stripe',
        stripe_session_id = coalesce(p_stripe_session_id, stripe_session_id),
        stripe_payment_id = p_stripe_payment_intent,
        paid_at = v_now
    WHERE id = p_payment_id;

    UPDATE public.bookings
    SET status = 'cancelled',
        cancel_reason = 'start_passed',
        hold_expires_at = NULL,
        updated_at = v_now
    WHERE id = p_booking_id;

    v_idempotency_key := 'ref_past_slot_' || p_payment_id;
    v_refund_res := public.reserve_payment_refund(
      p_payment_id, p_booking_id, p_amount, p_currency, 'stripe', 'MATCH_START_PASSED_REFUND', v_idempotency_key, p_stripe_payment_intent
    );

    RETURN jsonb_build_object(
      'action', 'REFUND_SCHEDULED', 
      'reason', 'MATCH_START_PASSED', 
      'payment_id', p_payment_id, 
      'idempotency_key', v_idempotency_key, 
      'refund_request_id', v_refund_res->>'refund_request_id'
    );
  END IF;

  -- Branch 4: Booking was explicitly cancelled (e.g. by expiration cleanup)
  IF v_booking.status = 'cancelled' THEN
    UPDATE public.payments
    SET status = 'paid',
        payment_method = 'stripe',
        stripe_session_id = coalesce(p_stripe_session_id, stripe_session_id),
        stripe_payment_id = p_stripe_payment_intent,
        paid_at = v_now
    WHERE id = p_payment_id;

    v_idempotency_key := 'ref_cancelled_' || p_payment_id;
    v_refund_res := public.reserve_payment_refund(
      p_payment_id, p_booking_id, p_amount, p_currency, 'stripe', 'CANCELLED_BOOKING_REFUND', v_idempotency_key, p_stripe_payment_intent
    );

    RETURN jsonb_build_object(
      'action', 'REFUND_SCHEDULED', 
      'reason', 'CANCELLED_BOOKING', 
      'payment_id', p_payment_id, 
      'idempotency_key', v_idempotency_key, 
      'refund_request_id', v_refund_res->>'refund_request_id'
    );
  END IF;

  -- Branch 5: Slot claimed by overlapping active reservation
  IF v_booking.court_id IS NULL THEN
    IF public.open_play_spots_taken(v_booking.open_play_session_id, p_booking_id) + v_booking.open_play_spots > v_capacity THEN
      v_conflict_id := p_booking_id;
    END IF;
  ELSE
  SELECT id INTO v_conflict_id
  FROM public.bookings
  WHERE court_id = v_booking.court_id
    AND booking_date = v_booking.booking_date
    AND id != p_booking_id
    AND status IN ('confirmed', 'checked_in', 'in_progress', 'completed')
    AND start_time < v_booking.end_time
    AND end_time > v_booking.start_time
  LIMIT 1;
  END IF;

  IF v_conflict_id IS NOT NULL THEN
    UPDATE public.payments
    SET status = 'paid',
        payment_method = 'stripe',
        stripe_session_id = coalesce(p_stripe_session_id, stripe_session_id),
        stripe_payment_id = p_stripe_payment_intent,
        paid_at = v_now
    WHERE id = p_payment_id;

    UPDATE public.bookings
    SET status = 'cancelled',
        cancel_reason = 'slot_conflict',
        hold_expires_at = NULL,
        updated_at = v_now
    WHERE id = p_booking_id;

    v_idempotency_key := 'ref_conflict_' || p_payment_id;
    v_refund_res := public.reserve_payment_refund(
      p_payment_id, p_booking_id, p_amount, p_currency, 'stripe', 'SLOT_CONFLICT_REFUND', v_idempotency_key, p_stripe_payment_intent
    );

    RETURN jsonb_build_object(
      'action', 'REFUND_SCHEDULED', 
      'reason', 'SLOT_CONFLICT', 
      'payment_id', p_payment_id, 
      'idempotency_key', v_idempotency_key, 
      'refund_request_id', v_refund_res->>'refund_request_id'
    );
  END IF;

  -- Branch 6: Eligible, Slot Free, Time Future -> Normal Confirmation
  UPDATE public.payments
  SET status = 'paid',
      stripe_session_id = coalesce(p_stripe_session_id, stripe_session_id),
      stripe_payment_id = p_stripe_payment_intent,
      payment_method = 'stripe',
      paid_at = v_now
  WHERE id = p_payment_id;

  UPDATE public.bookings
  SET status = 'confirmed',
      hold_expires_at = NULL,
      updated_at = v_now
  WHERE id = p_booking_id;

  RETURN jsonb_build_object('action', 'CONFIRMED', 'booking_id', p_booking_id, 'payment_id', p_payment_id);
END;
$$;


--
-- Name: record_booking_event(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_booking_event() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
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


--
-- Name: record_payment_event(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_payment_event() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
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


--
-- Name: record_settings_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_settings_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_actor uuid;
  v_before jsonb;
  v_after jsonb;
BEGIN
  BEGIN
    v_actor := (SELECT id FROM public.profiles WHERE id = auth.uid());

    v_before := jsonb_build_object('account_name', OLD.gcash_account_name, 'number', OLD.gcash_number, 'qr_url', OLD.gcash_qr_url);
    v_after := jsonb_build_object('account_name', NEW.gcash_account_name, 'number', NEW.gcash_number, 'qr_url', NEW.gcash_qr_url);
    IF v_after IS DISTINCT FROM v_before THEN
      INSERT INTO public.settings_changes (actor_id, area, before, after) VALUES (v_actor, 'gcash', v_before, v_after);
    END IF;

    v_before := jsonb_build_object('cancel_cutoff_hours', OLD.cancel_cutoff_hours, 'no_show_grace_minutes', OLD.no_show_grace_minutes);
    v_after := jsonb_build_object('cancel_cutoff_hours', NEW.cancel_cutoff_hours, 'no_show_grace_minutes', NEW.no_show_grace_minutes);
    IF v_after IS DISTINCT FROM v_before THEN
      INSERT INTO public.settings_changes (actor_id, area, before, after) VALUES (v_actor, 'policy', v_before, v_after);
    END IF;

    v_before := jsonb_build_object('venue_phone', OLD.venue_phone, 'venue_email', OLD.venue_email, 'venue_address', OLD.venue_address);
    v_after := jsonb_build_object('venue_phone', NEW.venue_phone, 'venue_email', NEW.venue_email, 'venue_address', NEW.venue_address);
    IF v_after IS DISTINCT FROM v_before THEN
      INSERT INTO public.settings_changes (actor_id, area, before, after) VALUES (v_actor, 'contact', v_before, v_after);
    END IF;
  EXCEPTION WHEN others THEN
    -- The log must never block a settings save
    RAISE WARNING 'settings change not recorded: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;


--
-- Name: reject_gcash_basket(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_gcash_basket(p_basket_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_ids uuid[];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'FORBIDDEN: Admin privileges required' USING ERRCODE = '42501';
  END IF;

  -- Only submitted rows: a court cancelled meanwhile is left alone
  SELECT array_agg(id) INTO v_ids
  FROM (
    SELECT b.id FROM public.bookings b
    WHERE b.basket_id = p_basket_id AND b.status = 'pending' AND b.hold_expires_at = 'infinity'
      AND EXISTS (SELECT 1 FROM public.payments p WHERE p.booking_id = b.id AND p.payment_method = 'gcash'
                  AND p.status = 'pending' AND p.gcash_submitted_at IS NOT NULL)
    ORDER BY b.court_id FOR UPDATE
  ) b;
  IF v_ids IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: No submitted GCash bookings in this basket' USING ERRCODE = 'P0001';
  END IF;
  PERFORM 1 FROM public.payments WHERE booking_id = ANY (v_ids) ORDER BY booking_id FOR UPDATE;

  UPDATE public.payments SET status = 'failed' WHERE booking_id = ANY (v_ids);
  UPDATE public.bookings SET status = 'cancelled', cancel_reason = 'gcash_rejected', hold_expires_at = NULL, updated_at = now()
  WHERE id = ANY (v_ids);

  RETURN jsonb_build_object('basket_id', p_basket_id, 'rejected', cardinality(v_ids));
END;
$$;


--
-- Name: release_expired_court_holds(uuid, date, time without time zone, time without time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.release_expired_court_holds(p_court_id uuid, p_booking_date date, p_start_time time without time zone, p_end_time time without time zone) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_ids uuid[];
BEGIN
  SELECT coalesce(array_agg(b.id), '{}') INTO v_ids
  FROM (
    SELECT id FROM public.bookings
    WHERE court_id = p_court_id
      AND booking_date = p_booking_date
      AND status = 'pending'
      AND public.hold_release_after(hold_expires_at, created_at) <= clock_timestamp()
      AND start_time < p_end_time
      AND end_time > p_start_time
    FOR UPDATE SKIP LOCKED
  ) b
  -- Same safety guards as cancel_expired_booking: never cancel paid or refunding holds
  WHERE NOT EXISTS (
      SELECT 1 FROM public.payments p
      WHERE p.booking_id = b.id
        AND (p.status IN ('paid', 'succeeded', 'refunded') OR p.paid_at IS NOT NULL)
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.refund_requests r
      WHERE r.booking_id = b.id
        AND r.status IN ('pending', 'processing', 'succeeded', 'pending_cash_handover', 'cash_refunded', 'requires_admin_review')
    );

  IF cardinality(v_ids) = 0 THEN
    RETURN 0;
  END IF;

  UPDATE public.payments SET status = 'failed'
  WHERE booking_id = ANY (v_ids) AND status = 'pending';

  UPDATE public.bookings SET status = 'cancelled', cancel_reason = 'expired', updated_at = clock_timestamp()
  WHERE id = ANY (v_ids);

  RETURN cardinality(v_ids);
END;
$$;


--
-- Name: request_manual_cash_refund(uuid, uuid, numeric, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.request_manual_cash_refund(p_payment_id uuid, p_booking_id uuid, p_amount numeric, p_currency text, p_reason text, p_idempotency_key text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_admin_id uuid;
  v_method text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required' USING ERRCODE = '42501';
  END IF;
  SELECT id INTO v_admin_id FROM public.profiles WHERE id = auth.uid() AND role = 'admin';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FORBIDDEN: Admin privileges required' USING ERRCODE = '42501';
  END IF;

  -- GCash payments are refunded by hand like cash; previously they failed MISMATCHED_PAYMENT_METHOD
  SELECT lower(payment_method) INTO v_method FROM public.payments WHERE id = p_payment_id;
  IF v_method IS NULL OR v_method NOT IN ('cash', 'gcash') THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Manual refunds are only for cash or GCash payments' USING ERRCODE = '22000';
  END IF;

  RETURN public.reserve_payment_refund(
    p_payment_id, p_booking_id, p_amount, p_currency, v_method, p_reason, p_idempotency_key, NULL, v_admin_id
  );
END;
$$;


--
-- Name: reserve_payment_refund(uuid, uuid, numeric, text, text, text, text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reserve_payment_refund(p_payment_id uuid, p_booking_id uuid, p_amount numeric, p_currency text, p_payment_method text, p_reason text, p_idempotency_key text, p_stripe_payment_intent text DEFAULT NULL::text, p_created_by uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_payment record;
  v_existing record;
  v_reserved_sum numeric;
  v_new_req_id uuid;
  v_effective_pi text;
  v_init_status text;
  v_diag_constraint text;
BEGIN
  IF coalesce(auth.role(), '') != 'service_role' THEN
    IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
      RAISE EXCEPTION 'FORBIDDEN: Admin or service role required' USING ERRCODE = '42501';
    END IF;
    p_created_by := auth.uid();
  END IF;

  IF p_idempotency_key IS NULL OR trim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: p_idempotency_key cannot be blank' USING ERRCODE = '22000';
  END IF;

  -- 1. Lock payment row (Hierarchy Level 3)
  SELECT id, booking_id, amount, currency, payment_method, status, stripe_payment_id
  INTO v_payment
  FROM public.payments
  WHERE id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Payment % does not exist', p_payment_id USING ERRCODE = 'P0002';
  END IF;

  IF v_payment.status NOT IN ('paid', 'refunded') THEN
    RAISE EXCEPTION 'INELIGIBLE_PAYMENT: Payment status is %, expected paid', v_payment.status USING ERRCODE = '22000';
  END IF;
  IF v_payment.booking_id != p_booking_id THEN
    RAISE EXCEPTION 'MISMATCHED_ASSOCIATION: Payment does not belong to booking' USING ERRCODE = '22000';
  END IF;
  IF lower(v_payment.currency) != lower(trim(p_currency)) THEN
    RAISE EXCEPTION 'MISMATCHED_CURRENCY: Expected %, got %', v_payment.currency, p_currency USING ERRCODE = '22000';
  END IF;
  IF lower(v_payment.payment_method) != lower(trim(p_payment_method)) THEN
    RAISE EXCEPTION 'MISMATCHED_PAYMENT_METHOD: Payment is %, requested %', v_payment.payment_method, p_payment_method USING ERRCODE = '22000';
  END IF;

  -- Compute normalized effective PaymentIntent
  v_effective_pi := coalesce(p_stripe_payment_intent, v_payment.stripe_payment_id);

  IF lower(trim(p_payment_method)) = 'stripe' AND v_payment.stripe_payment_id IS NOT NULL AND v_effective_pi IS NOT NULL THEN
    IF v_payment.stripe_payment_id != v_effective_pi THEN
      RAISE EXCEPTION 'MISMATCHED_PAYMENT_INTENT: Payment has %, requested %', v_payment.stripe_payment_id, v_effective_pi USING ERRCODE = '22000';
    END IF;
  END IF;

  -- Full-refund-only enforcement
  IF p_amount != v_payment.amount THEN
    RAISE EXCEPTION 'FULL_REFUND_ONLY: Partial refunds prohibited. Captured %, requested %', v_payment.amount, p_amount USING ERRCODE = '22000';
  END IF;

  -- 2. Inspect existing idempotency key (Hierarchy Level 4)
  SELECT * INTO v_existing
  FROM public.refund_requests
  WHERE idempotency_key = trim(p_idempotency_key)
  FOR UPDATE;

  IF FOUND THEN
    -- Verify complete normalized tuple
    IF v_existing.payment_id = p_payment_id
       AND v_existing.booking_id = p_booking_id
       AND v_existing.amount = p_amount
       AND lower(v_existing.currency) = lower(trim(p_currency))
       AND lower(v_existing.payment_method) = lower(trim(p_payment_method))
       AND trim(v_existing.reason) = trim(p_reason)
       AND coalesce(v_existing.stripe_payment_intent, '') = coalesce(v_effective_pi, '') THEN
      RETURN jsonb_build_object(
        'success', true,
        'idempotent', true,
        'refund_request_id', v_existing.id,
        'status', v_existing.status,
        'amount', v_existing.amount
      );
    ELSE
      RAISE EXCEPTION 'IDEMPOTENCY_KEY_CONFLICT: Key % already used with conflicting parameters', p_idempotency_key USING ERRCODE = '22000';
    END IF;
  END IF;

  -- 3. Check cumulative capacity across all non-freed statuses
  SELECT coalesce(sum(amount), 0) INTO v_reserved_sum
  FROM public.refund_requests
  WHERE payment_id = p_payment_id
    AND status IN ('pending', 'processing', 'succeeded', 'requires_admin_review', 'pending_cash_handover', 'cash_refunded');

  IF (v_reserved_sum + p_amount) > v_payment.amount THEN
    RAISE EXCEPTION 'REFUND_CAP_EXCEEDED: Requested % exceeds remaining capacity %',
      p_amount, (v_payment.amount - v_reserved_sum) USING ERRCODE = '22003';
  END IF;

  -- Only Stripe refunds go to the automatic worker; cash and GCash are handed back by staff
  v_init_status := CASE WHEN lower(trim(p_payment_method)) IN ('cash', 'gcash') THEN 'pending_cash_handover' ELSE 'pending' END;

  -- 4. Insert reservation record
  INSERT INTO public.refund_requests (
    payment_id,
    booking_id,
    amount,
    currency,
    payment_method,
    reason,
    idempotency_key,
    stripe_payment_intent,
    status,
    created_by
  ) VALUES (
    p_payment_id,
    p_booking_id,
    p_amount,
    lower(trim(p_currency)),
    lower(trim(p_payment_method)),
    trim(p_reason),
    trim(p_idempotency_key),
    v_effective_pi,
    v_init_status,
    p_created_by
  ) RETURNING id INTO v_new_req_id;

  RETURN jsonb_build_object(
    'success', true,
    'idempotent', false,
    'refund_request_id', v_new_req_id,
    'status', v_init_status,
    'amount', p_amount
  );

EXCEPTION
  WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_diag_constraint = CONSTRAINT_NAME;
    IF v_diag_constraint IS NOT NULL AND v_diag_constraint != 'uq_refund_requests_idempotency_key' THEN
      RAISE;
    END IF;

    SELECT * INTO v_existing FROM public.refund_requests WHERE idempotency_key = trim(p_idempotency_key) FOR UPDATE;
    IF FOUND AND v_existing.payment_id = p_payment_id 
       AND v_existing.booking_id = p_booking_id
       AND v_existing.amount = p_amount
       AND lower(v_existing.currency) = lower(trim(p_currency))
       AND lower(v_existing.payment_method) = lower(trim(p_payment_method))
       AND trim(v_existing.reason) = trim(p_reason)
       AND coalesce(v_existing.stripe_payment_intent, '') = coalesce(v_effective_pi, '') THEN
      RETURN jsonb_build_object('success', true, 'idempotent', true, 'refund_request_id', v_existing.id, 'status', v_existing.status);
    ELSE
      RAISE EXCEPTION 'IDEMPOTENCY_KEY_CONFLICT: Concurrent unique violation with different parameters' USING ERRCODE = '22000';
    END IF;
END;
$$;


--
-- Name: save_open_play_schedule(uuid, text, time without time zone, time without time zone, uuid[], integer, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_open_play_schedule(p_id uuid, p_day_of_week text, p_start_time time without time zone, p_end_time time without time zone, p_court_ids uuid[], p_capacity integer, p_price_per_spot numeric) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN: Admin privileges required' USING ERRCODE = '42501';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.open_play_schedules (day_of_week, start_time, end_time, court_ids, capacity, price_per_spot)
    VALUES (p_day_of_week, p_start_time, p_end_time, p_court_ids, p_capacity, p_price_per_spot)
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  UPDATE public.open_play_schedules
  SET day_of_week = p_day_of_week, start_time = p_start_time, end_time = p_end_time,
      court_ids = p_court_ids, capacity = p_capacity, price_per_spot = p_price_per_spot
  WHERE id = p_id
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Schedule does not exist' USING ERRCODE = 'P0002';
  END IF;

  -- Holds lock their session row FOR UPDATE; taking the same locks keeps a racing hold from landing on a session we delete
  PERFORM 1 FROM public.open_play_sessions
  WHERE schedule_id = p_id AND session_date >= (now() AT TIME ZONE 'Asia/Manila')::date FOR UPDATE;

  -- Future sessions nobody has booked are dropped (cancelled dates stay cancelled: staff skip a date by cancelling it) so the generator rebuilds them with the new values
  -- Two statements: the bookings FK is RESTRICT, so blocks must go first
  DELETE FROM public.bookings WHERE open_play_session_id IN (
    SELECT s.id FROM public.open_play_sessions s
    WHERE s.schedule_id = p_id
      AND s.session_date >= (now() AT TIME ZONE 'Asia/Manila')::date
      AND s.status <> 'cancelled'
      AND NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.open_play_session_id = s.id AND b.court_id IS NULL)
  );
  DELETE FROM public.open_play_sessions WHERE id IN (
    SELECT s.id FROM public.open_play_sessions s
    WHERE s.schedule_id = p_id
      AND s.session_date >= (now() AT TIME ZONE 'Asia/Manila')::date
      AND s.status <> 'cancelled'
      AND NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.open_play_session_id = s.id AND b.court_id IS NULL)
  );
  RETURN v_id;
END;
$$;


--
-- Name: save_pricing_settings(numeric, integer, integer, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_pricing_settings(p_base_hourly_rate numeric, p_min_hours integer, p_max_hours integer, p_peak_rates jsonb DEFAULT '[]'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_before jsonb;
  v_after jsonb;
BEGIN
  -- Prices are the owner's: front-desk staff can't change them
  IF coalesce(auth.role(), '') != 'service_role' AND NOT public.is_owner() THEN
    RAISE EXCEPTION 'FORBIDDEN: Only the owner can change prices' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(coalesce(p_peak_rates, '[]'::jsonb)) != 'array' THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: p_peak_rates must be a JSON array' USING ERRCODE = '22000';
  END IF;

  v_before := public.pricing_snapshot();

  -- Table CHECK constraints validate every value; a violation aborts the whole save
  UPDATE public.booking_settings
  SET base_hourly_rate = p_base_hourly_rate,
      min_hours = p_min_hours,
      max_hours = p_max_hours,
      updated_at = clock_timestamp(),
      updated_by = auth.uid()
  WHERE id;

  DELETE FROM public.peak_rates WHERE true;
  INSERT INTO public.peak_rates (label, days, start_time, end_time, hourly_rate)
  SELECT coalesce(r->>'label', ''),
         ARRAY(SELECT jsonb_array_elements_text(r->'days')),
         (r->>'start_time')::time,
         (r->>'end_time')::time,
         (r->>'hourly_rate')::numeric
  FROM jsonb_array_elements(coalesce(p_peak_rates, '[]'::jsonb)) AS r;

  -- Who changed what, kept with the save (nothing logged when the save changed nothing)
  v_after := public.pricing_snapshot();
  IF v_after IS DISTINCT FROM v_before THEN
    INSERT INTO public.pricing_changes (actor_id, before, after)
    VALUES ((SELECT id FROM public.profiles WHERE id = auth.uid()), v_before, v_after);
  END IF;

  RETURN jsonb_build_object(
    'base_hourly_rate', p_base_hourly_rate,
    'min_hours', p_min_hours,
    'max_hours', p_max_hours,
    'peak_rates', (SELECT count(*) FROM public.peak_rates)
  );
END;
$$;


--
-- Name: set_open_play_schedule_active(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_open_play_schedule_active(p_id uuid, p_active boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN: Admin privileges required' USING ERRCODE = '42501';
  END IF;
  UPDATE public.open_play_schedules SET active = p_active WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Schedule does not exist' USING ERRCODE = 'P0002';
  END IF;
END;
$$;


--
-- Name: set_staff_access(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_staff_access(p_user_id uuid, p_access text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_before text;
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'FORBIDDEN: Only the owner can change staff access' USING ERRCODE = '42501';
  END IF;
  IF p_access IS NULL OR p_access NOT IN ('owner', 'staff', 'none') THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: access must be owner, staff or none' USING ERRCODE = '22000';
  END IF;

  -- Serialise staff changes so two changes can't leave the venue with no owner
  LOCK TABLE public.profiles IN SHARE ROW EXCLUSIVE MODE;

  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Account does not exist' USING ERRCODE = 'P0002';
  END IF;
  v_before := CASE WHEN v_profile.role = 'admin' AND v_profile.is_owner THEN 'owner'
                   WHEN v_profile.role = 'admin' THEN 'staff' ELSE 'none' END;
  IF v_before = p_access THEN
    RETURN jsonb_build_object('id', v_profile.id, 'access', v_before, 'changed', false);
  END IF;
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'CANNOT_CHANGE_SELF: You cannot change your own access' USING ERRCODE = 'P0001';
  END IF;
  IF v_before = 'owner' AND (SELECT count(*) FROM public.profiles WHERE role = 'admin' AND is_owner) <= 1 THEN
    RAISE EXCEPTION 'LAST_OWNER: The venue must keep at least one owner' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.profiles
  SET role = CASE WHEN p_access = 'none' THEN 'customer' ELSE 'admin' END,
      is_owner = (p_access = 'owner')
  WHERE id = p_user_id;

  INSERT INTO public.settings_changes (actor_id, area, before, after)
  VALUES (
    (SELECT id FROM public.profiles WHERE id = auth.uid()),
    'staff',
    jsonb_build_object('account', coalesce(v_profile.email, v_profile.full_name), 'access', v_before),
    jsonb_build_object('account', coalesce(v_profile.email, v_profile.full_name), 'access', p_access)
  );

  RETURN jsonb_build_object('id', v_profile.id, 'access', p_access, 'changed', true);
END;
$$;


--
-- Name: settle_counter_basket(uuid, numeric, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.settle_counter_basket(p_basket_id uuid, p_expected_amount numeric, p_payment_method text, p_payment_reference text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_line record;
  v_count integer := 0;
  v_amount numeric := 0;
BEGIN
  -- Same admin rule as settle_counter_payment, checked first so a non-admin cannot probe basket ids
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'FORBIDDEN: Admin privileges required' USING ERRCODE = '42501';
  END IF;

  -- court_id order keeps lock order stable across concurrent settlements
  FOR v_line IN
    SELECT b.id AS booking_id, p.id AS payment_id, p.amount
    FROM public.bookings b
    JOIN public.payments p ON p.booking_id = b.id AND p.status = 'pending'
    WHERE b.basket_id = p_basket_id AND b.status = 'pending'
    ORDER BY b.court_id
  LOOP
    PERFORM public.settle_counter_payment(v_line.booking_id, v_line.payment_id, p_payment_method, p_payment_reference);
    v_count := v_count + 1;
    v_amount := v_amount + v_line.amount;
  END LOOP;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'NOT_FOUND: Basket % has no pending booking', p_basket_id USING ERRCODE = 'P0002';
  END IF;

  -- A court cancelled or added after staff saw the total: undo every settlement above (staff send a float sum)
  IF round(v_amount, 2) IS DISTINCT FROM round(p_expected_amount, 2) THEN
    RAISE EXCEPTION 'AMOUNT_CHANGED: Basket % totals % PHP, staff expected % PHP', p_basket_id, v_amount, p_expected_amount USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object('basket_id', p_basket_id, 'settled', v_count, 'amount', v_amount);
END;
$$;


--
-- Name: settle_counter_payment(uuid, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.settle_counter_payment(p_booking_id uuid, p_payment_id uuid, p_payment_method text, p_payment_reference text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

  -- pending: an online hold still within its checkout window; confirmed: a "Pay Later" walk-in
  IF v_booking.status NOT IN ('pending', 'confirmed') THEN
    RAISE EXCEPTION 'INVALID_STATUS: Booking is in status %, expected pending or confirmed', v_booking.status USING ERRCODE = '22000';
  END IF;

  -- An online hold whose timer ran out is over; staff record a new walk-in instead of reviving it
  IF v_booking.status = 'pending'
     AND coalesce(v_booking.hold_expires_at, v_booking.created_at + interval '35 minutes') <= v_now THEN
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

  UPDATE public.bookings
  SET status = 'confirmed',
      hold_expires_at = NULL,
      updated_at = v_now
  WHERE id = p_booking_id;

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', p_booking_id,
    'payment_id', p_payment_id,
    'status', 'confirmed',
    'paid_at', v_now
  );
END;
$$;


--
-- Name: settle_stripe_refund(uuid, text, text, text, numeric, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.settle_stripe_refund(p_refund_request_id uuid, p_stripe_refund_id text, p_stripe_status text, p_stripe_payment_intent text, p_amount numeric, p_currency text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_refund_req record;
  v_payment record;
  v_total_succeeded numeric;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF coalesce(auth.role(), '') != 'service_role' AND (session_user != 'postgres' OR auth.role() IS NOT NULL) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Service role required' USING ERRCODE = '42501';
  END IF;

  -- 1. Lock payments row (Hierarchy Level 3)
  SELECT p.* INTO v_payment
  FROM public.payments p
  JOIN public.refund_requests r ON r.payment_id = p.id
  WHERE r.id = p_refund_request_id
  FOR UPDATE OF p;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Payment record for refund request % not found', p_refund_request_id USING ERRCODE = 'P0002';
  END IF;

  -- 2. Lock refund_requests row (Hierarchy Level 4)
  SELECT * INTO v_refund_req
  FROM public.refund_requests
  WHERE id = p_refund_request_id
  FOR UPDATE;

  -- Verify association, amount, currency, and PaymentIntent
  IF v_refund_req.amount != p_amount OR v_payment.amount != p_amount THEN
    RAISE EXCEPTION 'MISMATCHED_AMOUNT: Settlement amount % does not match payment amount %', p_amount, v_payment.amount USING ERRCODE = '22000';
  END IF;
  IF lower(v_refund_req.currency) != lower(p_currency) OR lower(v_payment.currency) != lower(p_currency) THEN
    RAISE EXCEPTION 'MISMATCHED_CURRENCY: Settlement currency % does not match payment currency %', p_currency, v_payment.currency USING ERRCODE = '22000';
  END IF;
  IF v_refund_req.stripe_payment_intent IS NOT NULL AND v_refund_req.stripe_payment_intent != p_stripe_payment_intent THEN
    RAISE EXCEPTION 'MISMATCHED_PAYMENT_INTENT: Expected %, got %', v_refund_req.stripe_payment_intent, p_stripe_payment_intent USING ERRCODE = '22000';
  END IF;

  -- Idempotency check for already succeeded settlement
  IF v_refund_req.status = 'succeeded' THEN
    IF v_refund_req.stripe_refund_id = p_stripe_refund_id THEN
      RETURN jsonb_build_object('success', true, 'status', 'succeeded', 'idempotent', true);
    ELSE
      RAISE EXCEPTION 'CONFLICT: Request already succeeded with different refund ID %', v_refund_req.stripe_refund_id USING ERRCODE = '22000';
    END IF;
  END IF;

  -- Validate Stripe Refund ID uniqueness across requests
  IF p_stripe_refund_id IS NOT NULL AND trim(p_stripe_refund_id) != '' THEN
    IF EXISTS (
      SELECT 1 FROM public.refund_requests 
      WHERE stripe_refund_id = p_stripe_refund_id AND id != p_refund_request_id
    ) THEN
      RAISE EXCEPTION 'DUPLICATE_STRIPE_REFUND_ID: Refund ID % already used', p_stripe_refund_id USING ERRCODE = '23505';
    END IF;
  END IF;

  -- Handle Verified Terminal Success
  IF lower(p_stripe_status) = 'succeeded' THEN
    IF p_stripe_refund_id IS NULL OR trim(p_stripe_refund_id) = '' THEN
      RAISE EXCEPTION 'INVALID_ARGUMENT: Persisted stripe_refund_id is required for succeeded settlement' USING ERRCODE = '22000';
    END IF;

    -- Cumulative check to prevent over-refunds
    SELECT coalesce(sum(amount), 0) INTO v_total_succeeded
    FROM public.refund_requests
    WHERE payment_id = v_payment.id AND status = 'succeeded' AND id != p_refund_request_id;

    IF (v_total_succeeded + p_amount) > v_payment.amount THEN
      RAISE EXCEPTION 'OVER_REFUND_PREVENTED: Total % exceeds captured %', (v_total_succeeded + p_amount), v_payment.amount USING ERRCODE = '22003';
    END IF;

    UPDATE public.refund_requests
    SET status = 'succeeded',
        stripe_refund_id = trim(p_stripe_refund_id),
        stripe_payment_intent = p_stripe_payment_intent,
        processed_at = v_now,
        updated_at = v_now,
        error_message = NULL
    WHERE id = p_refund_request_id;

    -- Full-refund policy: exactly 100% refunded
    UPDATE public.payments 
    SET status = 'refunded' 
    WHERE id = v_payment.id;

    RETURN jsonb_build_object('success', true, 'status', 'succeeded', 'payment_status', 'refunded');

  -- Handle Nonterminal States: Must never mark payment as refunded
  ELSIF lower(p_stripe_status) IN ('pending', 'processing') THEN
    UPDATE public.refund_requests
    SET status = 'processing',
        stripe_refund_id = coalesce(trim(p_stripe_refund_id), stripe_refund_id),
        stripe_payment_intent = p_stripe_payment_intent,
        updated_at = v_now
    WHERE id = p_refund_request_id;

    RETURN jsonb_build_object('success', true, 'status', 'processing', 'payment_status', v_payment.status);

  -- Handle Terminal Failure
  ELSIF lower(p_stripe_status) = 'failed' THEN
    UPDATE public.refund_requests
    SET status = 'failed',
        stripe_refund_id = coalesce(trim(p_stripe_refund_id), stripe_refund_id),
        error_message = 'Stripe terminal refund failure',
        updated_at = v_now
    WHERE id = p_refund_request_id;

    RETURN jsonb_build_object('success', true, 'status', 'failed', 'payment_status', v_payment.status);

  ELSE
    -- Uncertain status -> requires admin review
    UPDATE public.refund_requests
    SET status = 'requires_admin_review',
        stripe_refund_id = coalesce(trim(p_stripe_refund_id), stripe_refund_id),
        error_message = 'Uncertain Stripe status: ' || p_stripe_status,
        updated_at = v_now
    WHERE id = p_refund_request_id;

    RETURN jsonb_build_object('success', true, 'status', 'requires_admin_review', 'payment_status', v_payment.status);
  END IF;
END;
$$;


--
-- Name: submit_gcash_proof(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.submit_gcash_proof(p_basket_id uuid, p_reference text, p_proof_path text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE
  v_ref text := regexp_replace(coalesce(p_reference, ''), '[\s-]', '', 'g');
  v_ids uuid[];
  v_submitted boolean;
  v_expired boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required' USING ERRCODE = '42501';
  END IF;
  IF v_ref !~ '^[A-Za-z0-9]{6,20}$' THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Reference must be 6-20 letters or digits' USING ERRCODE = '22000';
  END IF;
  IF p_proof_path IS NULL OR left(p_proof_path, length(auth.uid()::text) + 1) != auth.uid()::text || '/'
     OR p_proof_path LIKE '%..%' OR length(p_proof_path) > 300 THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Proof must be in your own folder' USING ERRCODE = '22000';
  END IF;

  SELECT array_agg(id), bool_or(hold_expires_at = 'infinity'),
         bool_or(coalesce(hold_expires_at, created_at + interval '35 minutes') <= clock_timestamp())
  INTO v_ids, v_submitted, v_expired
  FROM (
    SELECT id, hold_expires_at, created_at FROM public.bookings
    WHERE basket_id = p_basket_id AND user_id = auth.uid() AND status = 'pending'
    ORDER BY court_id FOR UPDATE
  ) b;
  IF v_ids IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: No pending bookings in this basket' USING ERRCODE = 'P0001';
  END IF;
  IF v_submitted THEN
    RAISE EXCEPTION 'ALREADY_SUBMITTED: Proof was already sent' USING ERRCODE = 'P0001';
  END IF;
  IF v_expired THEN
    RAISE EXCEPTION 'HOLD_EXPIRED: The hold has expired' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM public.payments
      WHERE booking_id = ANY (v_ids) AND payment_method = 'gcash' AND status = 'pending') != cardinality(v_ids) THEN
    RAISE EXCEPTION 'INVALID_STATUS: Payment is not a pending GCash payment' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.payments
  SET payment_reference = v_ref, gcash_proof_path = p_proof_path, gcash_submitted_at = now()
  WHERE booking_id = ANY (v_ids);
  UPDATE public.bookings SET hold_expires_at = 'infinity' WHERE id = ANY (v_ids);
  -- shortcut: proof file existence isn't checked server-side; admin rejects a missing screenshot, upgrade if fake submissions become common

  RETURN jsonb_build_object('basket_id', p_basket_id, 'submitted', cardinality(v_ids));
END;
$_$;


--
-- Name: update_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: auth_rate_limits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_rate_limits (
    key text NOT NULL,
    window_start timestamp with time zone NOT NULL,
    count integer NOT NULL,
    CONSTRAINT auth_rate_limits_count_check CHECK ((count >= 0)),
    CONSTRAINT auth_rate_limits_key_check CHECK ((length(key) <= 300))
);

ALTER TABLE ONLY public.auth_rate_limits FORCE ROW LEVEL SECURITY;


--
-- Name: booking_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.booking_events (
    id bigint NOT NULL,
    booking_id uuid NOT NULL,
    action text NOT NULL,
    detail text,
    actor_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.booking_events FORCE ROW LEVEL SECURITY;


--
-- Name: booking_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.booking_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: booking_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.booking_events_id_seq OWNED BY public.booking_events.id;


--
-- Name: booking_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.booking_settings (
    id boolean DEFAULT true NOT NULL,
    base_hourly_rate numeric(10,2) NOT NULL,
    min_hours integer NOT NULL,
    max_hours integer NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    gcash_account_name text,
    gcash_number text,
    gcash_qr_url text,
    cancel_cutoff_hours integer DEFAULT 2 NOT NULL,
    no_show_grace_minutes integer DEFAULT 15 NOT NULL,
    venue_phone text DEFAULT '+63 917 123 4567'::text NOT NULL,
    venue_email text DEFAULT 'play@crosshairdinkers.com'::text NOT NULL,
    venue_address text DEFAULT 'J.C. Aquino Ave, Butuan City'::text NOT NULL,
    CONSTRAINT booking_settings_base_hourly_rate_check CHECK ((base_hourly_rate > (0)::numeric)),
    CONSTRAINT booking_settings_cancel_cutoff_range CHECK (((cancel_cutoff_hours >= 0) AND (cancel_cutoff_hours <= 72))),
    CONSTRAINT booking_settings_gcash_check CHECK ((((gcash_account_name IS NULL) AND (gcash_number IS NULL)) OR ((gcash_account_name IS NOT NULL) AND (gcash_number IS NOT NULL) AND ((char_length(gcash_account_name) >= 1) AND (char_length(gcash_account_name) <= 100)) AND (gcash_number ~ '^09[0-9]{9}$'::text)))),
    CONSTRAINT booking_settings_hours_check CHECK ((max_hours >= min_hours)),
    CONSTRAINT booking_settings_id_check CHECK (id),
    CONSTRAINT booking_settings_max_hours_check CHECK ((max_hours <= 12)),
    CONSTRAINT booking_settings_min_hours_check CHECK ((min_hours >= 1)),
    CONSTRAINT booking_settings_no_show_grace_range CHECK (((no_show_grace_minutes >= 0) AND (no_show_grace_minutes <= 120))),
    CONSTRAINT booking_settings_venue_contact_check CHECK ((((char_length(venue_phone) >= 7) AND (char_length(venue_phone) <= 20)) AND (venue_phone ~ '^[+0-9 ()-]+$'::text) AND ((char_length(venue_email) >= 3) AND (char_length(venue_email) <= 254)) AND (venue_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'::text) AND ((char_length(venue_address) >= 3) AND (char_length(venue_address) <= 200))))
);

ALTER TABLE ONLY public.booking_settings FORCE ROW LEVEL SECURITY;


--
-- Name: bookings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bookings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    court_id uuid,
    booking_date date NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    total_amount numeric(10,2) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    customer_id uuid,
    customer_name text NOT NULL,
    checked_in_at timestamp with time zone,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    no_show_at timestamp with time zone,
    hold_expires_at timestamp with time zone,
    cancel_reason text,
    basket_id uuid,
    open_play_session_id uuid,
    open_play_spots smallint,
    cancel_note text,
    CONSTRAINT bookings_cancel_note_length CHECK ((char_length(cancel_note) <= 200)),
    CONSTRAINT bookings_cancel_reason_check CHECK (((cancel_reason IS NULL) OR (cancel_reason = ANY (ARRAY['expired'::text, 'customer'::text, 'admin'::text, 'checkout_failed'::text, 'slot_conflict'::text, 'court_unavailable'::text, 'start_passed'::text, 'gcash_rejected'::text, 'payment_kept'::text])))),
    CONSTRAINT bookings_court_or_open_play CHECK ((((court_id IS NOT NULL) AND (open_play_spots IS NULL)) OR ((court_id IS NULL) AND (open_play_session_id IS NOT NULL) AND ((open_play_spots >= 1) AND (open_play_spots <= 4))))),
    CONSTRAINT bookings_customer_identity_check CHECK ((((user_id IS NOT NULL) AND (customer_id IS NULL)) OR ((user_id IS NULL) AND (customer_id IS NOT NULL)) OR ((open_play_session_id IS NOT NULL) AND (open_play_spots IS NULL) AND (user_id IS NULL) AND (customer_id IS NULL)))),
    CONSTRAINT bookings_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'checked_in'::text, 'in_progress'::text, 'completed'::text, 'cancelled'::text, 'no_show'::text]))),
    CONSTRAINT bookings_total_amount_check CHECK ((total_amount >= (0)::numeric)),
    CONSTRAINT valid_booking_time CHECK ((end_time > start_time))
);

ALTER TABLE ONLY public.bookings FORCE ROW LEVEL SECURITY;


--
-- Name: courts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.courts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    maintenance_note text,
    maintenance_until date,
    CONSTRAINT courts_maintenance_note_length CHECK ((char_length(maintenance_note) <= 120)),
    CONSTRAINT courts_status_check CHECK ((status = ANY (ARRAY['active'::text, 'maintenance'::text])))
);

ALTER TABLE ONLY public.courts FORCE ROW LEVEL SECURITY;


--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    full_name text NOT NULL,
    phone text,
    email text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE ONLY public.customers FORCE ROW LEVEL SECURITY;


--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    booking_id uuid NOT NULL,
    stripe_session_id text,
    stripe_payment_id text,
    amount numeric(10,2) NOT NULL,
    currency text DEFAULT 'PHP'::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    paid_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    payment_method text,
    payment_reference text,
    gcash_proof_path text,
    gcash_submitted_at timestamp with time zone,
    CONSTRAINT payments_amount_check CHECK ((amount >= (0)::numeric)),
    CONSTRAINT payments_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'paid'::text, 'failed'::text, 'refunded'::text])))
);

ALTER TABLE ONLY public.payments FORCE ROW LEVEL SECURITY;


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    role text DEFAULT 'customer'::text NOT NULL,
    full_name text,
    created_at timestamp with time zone DEFAULT now(),
    phone text,
    email text,
    is_owner boolean DEFAULT false NOT NULL,
    CONSTRAINT profiles_owner_is_staff CHECK (((NOT is_owner) OR (role = 'admin'::text))),
    CONSTRAINT profiles_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'customer'::text])))
);

ALTER TABLE ONLY public.profiles FORCE ROW LEVEL SECURITY;


--
-- Name: customer_directory; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.customer_directory WITH (security_invoker='true') AS
 SELECT p.id,
    'registered'::text AS type,
    p.full_name,
    p.email,
    p.phone,
    p.created_at,
    h.bookings_count,
    h.last_visit,
    h.no_shows,
    m.total_spent
   FROM ((public.profiles p
     CROSS JOIN LATERAL ( SELECT (count(*) FILTER (WHERE (b.status = ANY (ARRAY['confirmed'::text, 'checked_in'::text, 'in_progress'::text, 'completed'::text, 'no_show'::text]))))::integer AS bookings_count,
            max(b.booking_date) FILTER (WHERE (b.status = ANY (ARRAY['checked_in'::text, 'in_progress'::text, 'completed'::text]))) AS last_visit,
            (count(*) FILTER (WHERE (b.status = 'no_show'::text)))::integer AS no_shows
           FROM public.bookings b
          WHERE (b.user_id = p.id)) h)
     CROSS JOIN LATERAL ( SELECT COALESCE(sum(pay.amount) FILTER (WHERE (pay.status = 'paid'::text)), (0)::numeric) AS total_spent
           FROM (public.payments pay
             JOIN public.bookings b ON ((b.id = pay.booking_id)))
          WHERE (b.user_id = p.id)) m)
  WHERE (COALESCE(p.role, ''::text) <> 'admin'::text)
UNION ALL
 SELECT c.id,
    'walk_in'::text AS type,
    c.full_name,
    c.email,
    c.phone,
    c.created_at,
    h.bookings_count,
    h.last_visit,
    h.no_shows,
    m.total_spent
   FROM ((public.customers c
     CROSS JOIN LATERAL ( SELECT (count(*) FILTER (WHERE (b.status = ANY (ARRAY['confirmed'::text, 'checked_in'::text, 'in_progress'::text, 'completed'::text, 'no_show'::text]))))::integer AS bookings_count,
            max(b.booking_date) FILTER (WHERE (b.status = ANY (ARRAY['checked_in'::text, 'in_progress'::text, 'completed'::text]))) AS last_visit,
            (count(*) FILTER (WHERE (b.status = 'no_show'::text)))::integer AS no_shows
           FROM public.bookings b
          WHERE (b.customer_id = c.id)) h)
     CROSS JOIN LATERAL ( SELECT COALESCE(sum(pay.amount) FILTER (WHERE (pay.status = 'paid'::text)), (0)::numeric) AS total_spent
           FROM (public.payments pay
             JOIN public.bookings b ON ((b.id = pay.booking_id)))
          WHERE (b.customer_id = c.id)) m);


--
-- Name: open_play_schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.open_play_schedules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    day_of_week text NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    court_ids uuid[] NOT NULL,
    capacity integer NOT NULL,
    price_per_spot numeric(10,2) NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT open_play_schedules_capacity_check CHECK ((capacity > 0)),
    CONSTRAINT open_play_schedules_check CHECK ((end_time > start_time)),
    CONSTRAINT open_play_schedules_check1 CHECK ((((start_time)::interval = date_trunc('hour'::text, (start_time)::interval)) AND ((end_time)::interval = date_trunc('hour'::text, (end_time)::interval)))),
    CONSTRAINT open_play_schedules_court_ids_check CHECK ((cardinality(court_ids) >= 1)),
    CONSTRAINT open_play_schedules_day_of_week_check CHECK ((day_of_week = ANY (ARRAY['Sunday'::text, 'Monday'::text, 'Tuesday'::text, 'Wednesday'::text, 'Thursday'::text, 'Friday'::text, 'Saturday'::text]))),
    CONSTRAINT open_play_schedules_price_per_spot_check CHECK ((price_per_spot > (0)::numeric))
);


--
-- Name: open_play_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.open_play_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    schedule_id uuid NOT NULL,
    session_date date NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    court_ids uuid[] NOT NULL,
    capacity integer NOT NULL,
    price_per_spot numeric(10,2) NOT NULL,
    status text NOT NULL,
    flag_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT open_play_sessions_status_check CHECK ((status = ANY (ARRAY['open'::text, 'cancelled'::text, 'flagged'::text])))
);


--
-- Name: operating_hours; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.operating_hours (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    day_of_week text NOT NULL,
    is_open boolean DEFAULT true NOT NULL,
    open_time time without time zone DEFAULT '08:00:00'::time without time zone,
    close_time time without time zone DEFAULT '22:00:00'::time without time zone,
    updated_at timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY public.operating_hours FORCE ROW LEVEL SECURITY;


--
-- Name: peak_rates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.peak_rates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    label text DEFAULT ''::text NOT NULL,
    days text[] NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    hourly_rate numeric(10,2) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT peak_rates_days_check CHECK (((cardinality(days) > 0) AND (days <@ ARRAY['Monday'::text, 'Tuesday'::text, 'Wednesday'::text, 'Thursday'::text, 'Friday'::text, 'Saturday'::text, 'Sunday'::text]))),
    CONSTRAINT peak_rates_end_time_check CHECK (((date_part('minute'::text, end_time) = (0)::double precision) AND (date_part('second'::text, end_time) = (0)::double precision))),
    CONSTRAINT peak_rates_hourly_rate_check CHECK ((hourly_rate > (0)::numeric)),
    CONSTRAINT peak_rates_label_check CHECK ((length(label) <= 60)),
    CONSTRAINT peak_rates_start_time_check CHECK (((date_part('minute'::text, start_time) = (0)::double precision) AND (date_part('second'::text, start_time) = (0)::double precision))),
    CONSTRAINT peak_rates_window_check CHECK ((end_time > start_time))
);

ALTER TABLE ONLY public.peak_rates FORCE ROW LEVEL SECURITY;


--
-- Name: pricing_changes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pricing_changes (
    id bigint NOT NULL,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    actor_id uuid,
    before jsonb NOT NULL,
    after jsonb NOT NULL
);

ALTER TABLE ONLY public.pricing_changes FORCE ROW LEVEL SECURITY;


--
-- Name: pricing_changes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pricing_changes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pricing_changes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pricing_changes_id_seq OWNED BY public.pricing_changes.id;


--
-- Name: refund_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refund_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payment_id uuid NOT NULL,
    booking_id uuid NOT NULL,
    amount numeric NOT NULL,
    currency text DEFAULT 'php'::text NOT NULL,
    payment_method text NOT NULL,
    reason text NOT NULL,
    status text NOT NULL,
    idempotency_key text NOT NULL,
    stripe_payment_intent text,
    stripe_refund_id text,
    receipt_reference text,
    cash_handover_notes text,
    created_by uuid,
    confirmed_by uuid,
    handover_confirmed_at timestamp with time zone,
    locked_at timestamp with time zone,
    locked_by text,
    lease_timeout_at timestamp with time zone,
    retry_count integer DEFAULT 0 NOT NULL,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone,
    CONSTRAINT refund_requests_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT refund_requests_payment_method_check CHECK ((payment_method = ANY (ARRAY['stripe'::text, 'cash'::text, 'gcash'::text]))),
    CONSTRAINT refund_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'succeeded'::text, 'failed'::text, 'requires_admin_review'::text, 'pending_cash_handover'::text, 'cash_refunded'::text, 'cancelled'::text])))
);

ALTER TABLE ONLY public.refund_requests FORCE ROW LEVEL SECURITY;


--
-- Name: settings_changes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settings_changes (
    id bigint NOT NULL,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    actor_id uuid,
    area text NOT NULL,
    before jsonb NOT NULL,
    after jsonb NOT NULL
);

ALTER TABLE ONLY public.settings_changes FORCE ROW LEVEL SECURITY;


--
-- Name: settings_changes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.settings_changes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: settings_changes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.settings_changes_id_seq OWNED BY public.settings_changes.id;


--
-- Name: venue_closures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.venue_closures (
    closed_on date NOT NULL,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT venue_closures_reason_check CHECK ((char_length(reason) <= 120))
);

ALTER TABLE ONLY public.venue_closures FORCE ROW LEVEL SECURITY;


--
-- Name: booking_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_events ALTER COLUMN id SET DEFAULT nextval('public.booking_events_id_seq'::regclass);


--
-- Name: pricing_changes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_changes ALTER COLUMN id SET DEFAULT nextval('public.pricing_changes_id_seq'::regclass);


--
-- Name: settings_changes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings_changes ALTER COLUMN id SET DEFAULT nextval('public.settings_changes_id_seq'::regclass);


--
-- Name: auth_rate_limits auth_rate_limits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_rate_limits
    ADD CONSTRAINT auth_rate_limits_pkey PRIMARY KEY (key);


--
-- Name: booking_events booking_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_events
    ADD CONSTRAINT booking_events_pkey PRIMARY KEY (id);


--
-- Name: booking_settings booking_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_settings
    ADD CONSTRAINT booking_settings_pkey PRIMARY KEY (id);


--
-- Name: bookings bookings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_pkey PRIMARY KEY (id);


--
-- Name: courts courts_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.courts
    ADD CONSTRAINT courts_name_key UNIQUE (name);


--
-- Name: courts courts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.courts
    ADD CONSTRAINT courts_pkey PRIMARY KEY (id);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: bookings no_overlapping_active_court_bookings; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT no_overlapping_active_court_bookings EXCLUDE USING gist (court_id WITH =, tsrange((booking_date + start_time), (booking_date + end_time)) WITH &&) WHERE ((status = ANY (ARRAY['confirmed'::text, 'checked_in'::text, 'in_progress'::text, 'completed'::text, 'pending'::text])));


--
-- Name: open_play_schedules open_play_schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_play_schedules
    ADD CONSTRAINT open_play_schedules_pkey PRIMARY KEY (id);


--
-- Name: open_play_sessions open_play_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_play_sessions
    ADD CONSTRAINT open_play_sessions_pkey PRIMARY KEY (id);


--
-- Name: open_play_sessions open_play_sessions_schedule_id_session_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_play_sessions
    ADD CONSTRAINT open_play_sessions_schedule_id_session_date_key UNIQUE (schedule_id, session_date);


--
-- Name: operating_hours operating_hours_day_of_week_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operating_hours
    ADD CONSTRAINT operating_hours_day_of_week_key UNIQUE (day_of_week);


--
-- Name: operating_hours operating_hours_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operating_hours
    ADD CONSTRAINT operating_hours_pkey PRIMARY KEY (id);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: peak_rates peak_rates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.peak_rates
    ADD CONSTRAINT peak_rates_pkey PRIMARY KEY (id);


--
-- Name: pricing_changes pricing_changes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_changes
    ADD CONSTRAINT pricing_changes_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: refund_requests refund_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund_requests
    ADD CONSTRAINT refund_requests_pkey PRIMARY KEY (id);


--
-- Name: settings_changes settings_changes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings_changes
    ADD CONSTRAINT settings_changes_pkey PRIMARY KEY (id);


--
-- Name: refund_requests uq_refund_requests_idempotency_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund_requests
    ADD CONSTRAINT uq_refund_requests_idempotency_key UNIQUE (idempotency_key);


--
-- Name: venue_closures venue_closures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venue_closures
    ADD CONSTRAINT venue_closures_pkey PRIMARY KEY (closed_on);


--
-- Name: booking_events_booking_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX booking_events_booking_idx ON public.booking_events USING btree (booking_id, created_at);


--
-- Name: bookings_open_play_session_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bookings_open_play_session_idx ON public.bookings USING btree (open_play_session_id) WHERE (open_play_session_id IS NOT NULL);


--
-- Name: idx_auth_rate_limits_window_start; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auth_rate_limits_window_start ON public.auth_rate_limits USING btree (window_start);


--
-- Name: idx_bookings_basket_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_basket_id ON public.bookings USING btree (basket_id) WHERE (basket_id IS NOT NULL);


--
-- Name: idx_bookings_court_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_court_date ON public.bookings USING btree (court_id, booking_date);


--
-- Name: idx_bookings_court_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_court_id ON public.bookings USING btree (court_id);


--
-- Name: idx_bookings_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_date ON public.bookings USING btree (booking_date);


--
-- Name: idx_bookings_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_user_id ON public.bookings USING btree (user_id);


--
-- Name: idx_customers_full_name_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_full_name_phone ON public.customers USING btree (full_name, phone);


--
-- Name: idx_payments_booking_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_booking_id ON public.payments USING btree (booking_id);


--
-- Name: idx_refund_requests_booking_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refund_requests_booking_id ON public.refund_requests USING btree (booking_id);


--
-- Name: idx_refund_requests_payment_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refund_requests_payment_id ON public.refund_requests USING btree (payment_id);


--
-- Name: idx_refund_requests_stripe_refund_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_refund_requests_stripe_refund_id ON public.refund_requests USING btree (stripe_refund_id) WHERE (stripe_refund_id IS NOT NULL);


--
-- Name: idx_refund_requests_worker_lease; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refund_requests_worker_lease ON public.refund_requests USING btree (status, lease_timeout_at, created_at) WHERE (status = ANY (ARRAY['pending'::text, 'processing'::text]));


--
-- Name: uq_payments_intent_per_booking; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_payments_intent_per_booking ON public.payments USING btree (stripe_payment_id, booking_id) WHERE (stripe_payment_id IS NOT NULL);


--
-- Name: uq_payments_one_pending_per_booking; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_payments_one_pending_per_booking ON public.payments USING btree (booking_id) WHERE (status = 'pending'::text);


--
-- Name: uq_payments_session_per_booking; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_payments_session_per_booking ON public.payments USING btree (stripe_session_id, booking_id) WHERE (stripe_session_id IS NOT NULL);


--
-- Name: booking_settings booking_settings_record_changes; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER booking_settings_record_changes AFTER UPDATE ON public.booking_settings FOR EACH ROW EXECUTE FUNCTION public.record_settings_change();


--
-- Name: bookings bookings_basket_id_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bookings_basket_id_immutable BEFORE UPDATE ON public.bookings FOR EACH ROW WHEN ((old.basket_id IS DISTINCT FROM new.basket_id)) EXECUTE FUNCTION public.bookings_basket_id_immutable();


--
-- Name: bookings bookings_block_closed_date; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bookings_block_closed_date BEFORE INSERT ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.block_closed_date_booking();


--
-- Name: bookings bookings_record_history; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bookings_record_history AFTER INSERT OR UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.record_booking_event();


--
-- Name: bookings bookings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bookings_updated_at BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: courts courts_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER courts_updated_at BEFORE UPDATE ON public.courts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: payments payments_record_history; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER payments_record_history AFTER INSERT OR UPDATE OF status ON public.payments FOR EACH ROW EXECUTE FUNCTION public.record_payment_event();


--
-- Name: booking_events booking_events_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_events
    ADD CONSTRAINT booking_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: booking_events booking_events_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_events
    ADD CONSTRAINT booking_events_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;


--
-- Name: bookings bookings_court_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_court_id_fkey FOREIGN KEY (court_id) REFERENCES public.courts(id) ON DELETE RESTRICT;


--
-- Name: bookings bookings_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE RESTRICT;


--
-- Name: bookings bookings_open_play_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_open_play_session_id_fkey FOREIGN KEY (open_play_session_id) REFERENCES public.open_play_sessions(id) ON DELETE RESTRICT;


--
-- Name: bookings bookings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: open_play_sessions open_play_sessions_schedule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_play_sessions
    ADD CONSTRAINT open_play_sessions_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES public.open_play_schedules(id) ON DELETE RESTRICT;


--
-- Name: payments payments_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;


--
-- Name: pricing_changes pricing_changes_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_changes
    ADD CONSTRAINT pricing_changes_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: refund_requests refund_requests_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund_requests
    ADD CONSTRAINT refund_requests_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE RESTRICT;


--
-- Name: refund_requests refund_requests_confirmed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund_requests
    ADD CONSTRAINT refund_requests_confirmed_by_fkey FOREIGN KEY (confirmed_by) REFERENCES public.profiles(id);


--
-- Name: refund_requests refund_requests_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund_requests
    ADD CONSTRAINT refund_requests_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: refund_requests refund_requests_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund_requests
    ADD CONSTRAINT refund_requests_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.payments(id) ON DELETE RESTRICT;


--
-- Name: settings_changes settings_changes_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings_changes
    ADD CONSTRAINT settings_changes_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: auth_rate_limits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.auth_rate_limits ENABLE ROW LEVEL SECURITY;

--
-- Name: booking_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.booking_events ENABLE ROW LEVEL SECURITY;

--
-- Name: booking_events booking_events_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY booking_events_admin_read ON public.booking_events FOR SELECT TO authenticated USING (public.is_admin());


--
-- Name: booking_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.booking_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: booking_settings booking_settings_admin_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY booking_settings_admin_policy ON public.booking_settings USING (((COALESCE(auth.role(), ''::text) = 'service_role'::text) OR ((CURRENT_USER = 'postgres'::name) AND (auth.role() IS NULL)) OR public.is_owner())) WITH CHECK (((COALESCE(auth.role(), ''::text) = 'service_role'::text) OR ((CURRENT_USER = 'postgres'::name) AND (auth.role() IS NULL)) OR public.is_owner()));


--
-- Name: booking_settings booking_settings_select_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY booking_settings_select_policy ON public.booking_settings FOR SELECT USING (true);


--
-- Name: bookings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

--
-- Name: bookings bookings_delete_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bookings_delete_policy ON public.bookings FOR DELETE USING (((COALESCE(auth.role(), ''::text) = 'service_role'::text) OR ((CURRENT_USER = 'postgres'::name) AND (auth.role() IS NULL)) OR (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))));


--
-- Name: bookings bookings_insert_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bookings_insert_policy ON public.bookings FOR INSERT WITH CHECK (((COALESCE(auth.role(), ''::text) = 'service_role'::text) OR ((CURRENT_USER = 'postgres'::name) AND (auth.role() IS NULL)) OR (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))));


--
-- Name: bookings bookings_select_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bookings_select_policy ON public.bookings FOR SELECT TO authenticated, service_role USING (((COALESCE(auth.role(), ''::text) = 'service_role'::text) OR ((CURRENT_USER = 'postgres'::name) AND (auth.role() IS NULL)) OR (user_id = auth.uid()) OR public.is_admin()));


--
-- Name: bookings bookings_update_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bookings_update_policy ON public.bookings FOR UPDATE USING (((COALESCE(auth.role(), ''::text) = 'service_role'::text) OR ((CURRENT_USER = 'postgres'::name) AND (auth.role() IS NULL)) OR (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))) OR ((user_id = auth.uid()) AND (status = 'pending'::text) AND (hold_expires_at IS DISTINCT FROM 'infinity'::timestamp with time zone)))) WITH CHECK (((COALESCE(auth.role(), ''::text) = 'service_role'::text) OR ((CURRENT_USER = 'postgres'::name) AND (auth.role() IS NULL)) OR (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))) OR ((user_id = auth.uid()) AND (status = 'cancelled'::text) AND (cancel_reason = 'customer'::text))));


--
-- Name: courts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.courts ENABLE ROW LEVEL SECURITY;

--
-- Name: courts courts_admin_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY courts_admin_policy ON public.courts USING (((COALESCE(auth.role(), ''::text) = 'service_role'::text) OR ((CURRENT_USER = 'postgres'::name) AND (auth.role() IS NULL)) OR (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))));


--
-- Name: courts courts_select_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY courts_select_policy ON public.courts FOR SELECT USING (true);


--
-- Name: customers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

--
-- Name: customers customers_admin_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY customers_admin_policy ON public.customers USING (((COALESCE(auth.role(), ''::text) = 'service_role'::text) OR ((CURRENT_USER = 'postgres'::name) AND (auth.role() IS NULL)) OR (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))));


--
-- Name: customers customers_select_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY customers_select_policy ON public.customers FOR SELECT USING (((COALESCE(auth.role(), ''::text) = 'service_role'::text) OR ((CURRENT_USER = 'postgres'::name) AND (auth.role() IS NULL)) OR (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))));


--
-- Name: open_play_schedules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.open_play_schedules ENABLE ROW LEVEL SECURITY;

--
-- Name: open_play_schedules open_play_schedules_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY open_play_schedules_admin ON public.open_play_schedules USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: open_play_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.open_play_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: open_play_sessions open_play_sessions_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY open_play_sessions_admin ON public.open_play_sessions USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: operating_hours; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.operating_hours ENABLE ROW LEVEL SECURITY;

--
-- Name: operating_hours operating_hours_admin_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY operating_hours_admin_policy ON public.operating_hours USING (((COALESCE(auth.role(), ''::text) = 'service_role'::text) OR ((CURRENT_USER = 'postgres'::name) AND (auth.role() IS NULL)) OR (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))));


--
-- Name: operating_hours operating_hours_select_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY operating_hours_select_policy ON public.operating_hours FOR SELECT USING (true);


--
-- Name: payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

--
-- Name: payments payments_delete_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payments_delete_policy ON public.payments FOR DELETE USING (((COALESCE(auth.role(), ''::text) = 'service_role'::text) OR ((CURRENT_USER = 'postgres'::name) AND (auth.role() IS NULL)) OR (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))));


--
-- Name: payments payments_insert_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payments_insert_policy ON public.payments FOR INSERT WITH CHECK (((COALESCE(auth.role(), ''::text) = 'service_role'::text) OR ((CURRENT_USER = 'postgres'::name) AND (auth.role() IS NULL)) OR (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))));


--
-- Name: payments payments_select_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payments_select_policy ON public.payments FOR SELECT USING (((COALESCE(auth.role(), ''::text) = 'service_role'::text) OR ((CURRENT_USER = 'postgres'::name) AND (auth.role() IS NULL)) OR (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))) OR (EXISTS ( SELECT 1
   FROM public.bookings b
  WHERE ((b.id = payments.booking_id) AND (b.user_id = auth.uid()))))));


--
-- Name: payments payments_update_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payments_update_policy ON public.payments FOR UPDATE USING (((COALESCE(auth.role(), ''::text) = 'service_role'::text) OR ((CURRENT_USER = 'postgres'::name) AND (auth.role() IS NULL)) OR (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))) OR ((EXISTS ( SELECT 1
   FROM public.bookings b
  WHERE ((b.id = payments.booking_id) AND (b.user_id = auth.uid())))) AND (status = 'pending'::text) AND (gcash_submitted_at IS NULL)))) WITH CHECK (((COALESCE(auth.role(), ''::text) = 'service_role'::text) OR ((CURRENT_USER = 'postgres'::name) AND (auth.role() IS NULL)) OR (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))) OR ((EXISTS ( SELECT 1
   FROM public.bookings b
  WHERE ((b.id = payments.booking_id) AND (b.user_id = auth.uid())))) AND (status = 'failed'::text))));


--
-- Name: peak_rates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.peak_rates ENABLE ROW LEVEL SECURITY;

--
-- Name: peak_rates peak_rates_admin_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY peak_rates_admin_policy ON public.peak_rates USING (((COALESCE(auth.role(), ''::text) = 'service_role'::text) OR ((CURRENT_USER = 'postgres'::name) AND (auth.role() IS NULL)) OR public.is_owner())) WITH CHECK (((COALESCE(auth.role(), ''::text) = 'service_role'::text) OR ((CURRENT_USER = 'postgres'::name) AND (auth.role() IS NULL)) OR public.is_owner()));


--
-- Name: peak_rates peak_rates_select_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY peak_rates_select_policy ON public.peak_rates FOR SELECT USING (true);


--
-- Name: pricing_changes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pricing_changes ENABLE ROW LEVEL SECURITY;

--
-- Name: pricing_changes pricing_changes_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pricing_changes_admin_read ON public.pricing_changes FOR SELECT TO authenticated USING (public.is_owner());


--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profiles_select_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_select_policy ON public.profiles FOR SELECT TO authenticated, service_role USING (((COALESCE(auth.role(), ''::text) = 'service_role'::text) OR ((CURRENT_USER = 'postgres'::name) AND (auth.role() IS NULL)) OR (id = auth.uid()) OR public.is_admin()));


--
-- Name: profiles profiles_update_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_update_policy ON public.profiles FOR UPDATE USING (((id = auth.uid()) OR (COALESCE(auth.role(), ''::text) = 'service_role'::text) OR ((CURRENT_USER = 'postgres'::name) AND (auth.role() IS NULL)))) WITH CHECK (((COALESCE(auth.role(), ''::text) = 'service_role'::text) OR ((CURRENT_USER = 'postgres'::name) AND (auth.role() IS NULL)) OR ((id = auth.uid()) AND (NOT (role IS DISTINCT FROM ( SELECT p.role
   FROM public.profiles p
  WHERE (p.id = auth.uid())))))));


--
-- Name: refund_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.refund_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: refund_requests refund_requests_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY refund_requests_admin_read ON public.refund_requests FOR SELECT TO authenticated USING (public.is_admin());


--
-- Name: refund_requests refund_requests_service_role; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY refund_requests_service_role ON public.refund_requests USING (((COALESCE(auth.role(), ''::text) = 'service_role'::text) OR ((CURRENT_USER = 'postgres'::name) AND (auth.role() IS NULL))));


--
-- Name: settings_changes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.settings_changes ENABLE ROW LEVEL SECURITY;

--
-- Name: settings_changes settings_changes_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY settings_changes_admin_read ON public.settings_changes FOR SELECT TO authenticated USING (public.is_owner());


--
-- Name: venue_closures; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.venue_closures ENABLE ROW LEVEL SECURITY;

--
-- Name: venue_closures venue_closures_admin_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY venue_closures_admin_policy ON public.venue_closures USING (((COALESCE(auth.role(), ''::text) = 'service_role'::text) OR ((CURRENT_USER = 'postgres'::name) AND (auth.role() IS NULL)) OR (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))));


--
-- Name: venue_closures venue_closures_select_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY venue_closures_select_policy ON public.venue_closures FOR SELECT USING (true);


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION add_open_play_walkup(p_session_id uuid, p_customer_id uuid, p_customer_name text, p_spots integer, p_payment_method text, p_payment_reference text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.add_open_play_walkup(p_session_id uuid, p_customer_id uuid, p_customer_name text, p_spots integer, p_payment_method text, p_payment_reference text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.add_open_play_walkup(p_session_id uuid, p_customer_id uuid, p_customer_name text, p_spots integer, p_payment_method text, p_payment_reference text) TO authenticated;
GRANT ALL ON FUNCTION public.add_open_play_walkup(p_session_id uuid, p_customer_id uuid, p_customer_name text, p_spots integer, p_payment_method text, p_payment_reference text) TO service_role;


--
-- Name: FUNCTION approve_gcash_basket(p_basket_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.approve_gcash_basket(p_basket_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.approve_gcash_basket(p_basket_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.approve_gcash_basket(p_basket_id uuid) TO service_role;


--
-- Name: FUNCTION block_closed_date_booking(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.block_closed_date_booking() TO anon;
GRANT ALL ON FUNCTION public.block_closed_date_booking() TO authenticated;
GRANT ALL ON FUNCTION public.block_closed_date_booking() TO service_role;


--
-- Name: FUNCTION booking_event_actor(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.booking_event_actor() FROM PUBLIC;
GRANT ALL ON FUNCTION public.booking_event_actor() TO service_role;


--
-- Name: FUNCTION bookings_basket_id_immutable(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.bookings_basket_id_immutable() TO anon;
GRANT ALL ON FUNCTION public.bookings_basket_id_immutable() TO authenticated;
GRANT ALL ON FUNCTION public.bookings_basket_id_immutable() TO service_role;


--
-- Name: FUNCTION cancel_expired_booking(p_booking_id uuid, p_payment_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cancel_expired_booking(p_booking_id uuid, p_payment_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cancel_expired_booking(p_booking_id uuid, p_payment_id uuid) TO service_role;


--
-- Name: FUNCTION cancel_open_play_session(p_session_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cancel_open_play_session(p_session_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cancel_open_play_session(p_session_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.cancel_open_play_session(p_session_id uuid) TO service_role;


--
-- Name: FUNCTION check_rate_limit(p_key text, p_limit integer, p_window_seconds integer, p_increment boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.check_rate_limit(p_key text, p_limit integer, p_window_seconds integer, p_increment boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.check_rate_limit(p_key text, p_limit integer, p_window_seconds integer, p_increment boolean) TO service_role;


--
-- Name: FUNCTION claim_pending_refund_request(p_worker_id text, p_lease_seconds integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.claim_pending_refund_request(p_worker_id text, p_lease_seconds integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_pending_refund_request(p_worker_id text, p_lease_seconds integer) TO service_role;


--
-- Name: FUNCTION confirm_checkout_hold(p_booking_id uuid, p_payment_id uuid, p_stripe_session_id text, p_hold_expires_at timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.confirm_checkout_hold(p_booking_id uuid, p_payment_id uuid, p_stripe_session_id text, p_hold_expires_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.confirm_checkout_hold(p_booking_id uuid, p_payment_id uuid, p_stripe_session_id text, p_hold_expires_at timestamp with time zone) TO authenticated;
GRANT ALL ON FUNCTION public.confirm_checkout_hold(p_booking_id uuid, p_payment_id uuid, p_stripe_session_id text, p_hold_expires_at timestamp with time zone) TO service_role;


--
-- Name: FUNCTION confirm_manual_cash_refund(p_refund_request_id uuid, p_receipt_reference text, p_notes text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.confirm_manual_cash_refund(p_refund_request_id uuid, p_receipt_reference text, p_notes text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.confirm_manual_cash_refund(p_refund_request_id uuid, p_receipt_reference text, p_notes text) TO authenticated;
GRANT ALL ON FUNCTION public.confirm_manual_cash_refund(p_refund_request_id uuid, p_receipt_reference text, p_notes text) TO service_role;


--
-- Name: FUNCTION create_walk_in_booking(p_court_id uuid, p_customer_name text, p_booking_date date, p_start_time time without time zone, p_end_time time without time zone, p_amount numeric, p_customer_id uuid, p_user_id uuid, p_payment_method text, p_payment_reference text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_walk_in_booking(p_court_id uuid, p_customer_name text, p_booking_date date, p_start_time time without time zone, p_end_time time without time zone, p_amount numeric, p_customer_id uuid, p_user_id uuid, p_payment_method text, p_payment_reference text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_walk_in_booking(p_court_id uuid, p_customer_name text, p_booking_date date, p_start_time time without time zone, p_end_time time without time zone, p_amount numeric, p_customer_id uuid, p_user_id uuid, p_payment_method text, p_payment_reference text) TO authenticated;
GRANT ALL ON FUNCTION public.create_walk_in_booking(p_court_id uuid, p_customer_name text, p_booking_date date, p_start_time time without time zone, p_end_time time without time zone, p_amount numeric, p_customer_id uuid, p_user_id uuid, p_payment_method text, p_payment_reference text) TO service_role;


--
-- Name: FUNCTION generate_open_play_sessions(p_days integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.generate_open_play_sessions(p_days integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.generate_open_play_sessions(p_days integer) TO authenticated;
GRANT ALL ON FUNCTION public.generate_open_play_sessions(p_days integer) TO service_role;


--
-- Name: FUNCTION get_my_refund_states(p_booking_ids uuid[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_refund_states(p_booking_ids uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_refund_states(p_booking_ids uuid[]) TO authenticated;
GRANT ALL ON FUNCTION public.get_my_refund_states(p_booking_ids uuid[]) TO service_role;


--
-- Name: FUNCTION get_open_play_sessions(p_from date, p_to date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_open_play_sessions(p_from date, p_to date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_open_play_sessions(p_from date, p_to date) TO anon;
GRANT ALL ON FUNCTION public.get_open_play_sessions(p_from date, p_to date) TO authenticated;
GRANT ALL ON FUNCTION public.get_open_play_sessions(p_from date, p_to date) TO service_role;


--
-- Name: FUNCTION get_public_slot_availability(p_booking_date date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_public_slot_availability(p_booking_date date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_public_slot_availability(p_booking_date date) TO anon;
GRANT ALL ON FUNCTION public.get_public_slot_availability(p_booking_date date) TO authenticated;
GRANT ALL ON FUNCTION public.get_public_slot_availability(p_booking_date date) TO service_role;


--
-- Name: FUNCTION handle_new_user(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
GRANT ALL ON FUNCTION public.handle_new_user() TO service_role;


--
-- Name: FUNCTION hold_court_basket(p_booking_date date, p_lines jsonb, p_hold_expires_at timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.hold_court_basket(p_booking_date date, p_lines jsonb, p_hold_expires_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.hold_court_basket(p_booking_date date, p_lines jsonb, p_hold_expires_at timestamp with time zone) TO authenticated;
GRANT ALL ON FUNCTION public.hold_court_basket(p_booking_date date, p_lines jsonb, p_hold_expires_at timestamp with time zone) TO service_role;


--
-- Name: FUNCTION hold_court_booking(p_court_id uuid, p_booking_date date, p_start_time time without time zone, p_end_time time without time zone, p_user_id uuid, p_amount numeric, p_hold_expires_at timestamp with time zone, p_basket_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.hold_court_booking(p_court_id uuid, p_booking_date date, p_start_time time without time zone, p_end_time time without time zone, p_user_id uuid, p_amount numeric, p_hold_expires_at timestamp with time zone, p_basket_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.hold_court_booking(p_court_id uuid, p_booking_date date, p_start_time time without time zone, p_end_time time without time zone, p_user_id uuid, p_amount numeric, p_hold_expires_at timestamp with time zone, p_basket_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.hold_court_booking(p_court_id uuid, p_booking_date date, p_start_time time without time zone, p_end_time time without time zone, p_user_id uuid, p_amount numeric, p_hold_expires_at timestamp with time zone, p_basket_id uuid) TO service_role;


--
-- Name: FUNCTION hold_gcash_basket(p_booking_date date, p_lines jsonb, p_hold_expires_at timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.hold_gcash_basket(p_booking_date date, p_lines jsonb, p_hold_expires_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.hold_gcash_basket(p_booking_date date, p_lines jsonb, p_hold_expires_at timestamp with time zone) TO authenticated;
GRANT ALL ON FUNCTION public.hold_gcash_basket(p_booking_date date, p_lines jsonb, p_hold_expires_at timestamp with time zone) TO service_role;


--
-- Name: FUNCTION hold_open_play_spots(p_session_id uuid, p_spots integer, p_payment_method text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.hold_open_play_spots(p_session_id uuid, p_spots integer, p_payment_method text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.hold_open_play_spots(p_session_id uuid, p_spots integer, p_payment_method text) TO authenticated;
GRANT ALL ON FUNCTION public.hold_open_play_spots(p_session_id uuid, p_spots integer, p_payment_method text) TO service_role;


--
-- Name: FUNCTION hold_release_after(p_hold_expires_at timestamp with time zone, p_created_at timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.hold_release_after(p_hold_expires_at timestamp with time zone, p_created_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.hold_release_after(p_hold_expires_at timestamp with time zone, p_created_at timestamp with time zone) TO service_role;


--
-- Name: FUNCTION is_admin(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_admin() TO authenticated;
GRANT ALL ON FUNCTION public.is_admin() TO service_role;


--
-- Name: FUNCTION is_owner(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_owner() FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_owner() TO authenticated;
GRANT ALL ON FUNCTION public.is_owner() TO service_role;


--
-- Name: FUNCTION move_booking(p_booking_id uuid, p_court_id uuid, p_booking_date date, p_start_time time without time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.move_booking(p_booking_id uuid, p_court_id uuid, p_booking_date date, p_start_time time without time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.move_booking(p_booking_id uuid, p_court_id uuid, p_booking_date date, p_start_time time without time zone) TO authenticated;
GRANT ALL ON FUNCTION public.move_booking(p_booking_id uuid, p_court_id uuid, p_booking_date date, p_start_time time without time zone) TO service_role;


--
-- Name: FUNCTION open_play_player_spots(p_session_id uuid, p_user_id uuid, p_customer_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.open_play_player_spots(p_session_id uuid, p_user_id uuid, p_customer_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.open_play_player_spots(p_session_id uuid, p_user_id uuid, p_customer_id uuid) TO service_role;


--
-- Name: FUNCTION open_play_spots_taken(p_session_id uuid, p_exclude_booking uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.open_play_spots_taken(p_session_id uuid, p_exclude_booking uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.open_play_spots_taken(p_session_id uuid, p_exclude_booking uuid) TO service_role;


--
-- Name: FUNCTION pricing_snapshot(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.pricing_snapshot() FROM PUBLIC;
GRANT ALL ON FUNCTION public.pricing_snapshot() TO service_role;


--
-- Name: FUNCTION quote_court_price(p_booking_date date, p_start_time time without time zone, p_end_time time without time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.quote_court_price(p_booking_date date, p_start_time time without time zone, p_end_time time without time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.quote_court_price(p_booking_date date, p_start_time time without time zone, p_end_time time without time zone) TO anon;
GRANT ALL ON FUNCTION public.quote_court_price(p_booking_date date, p_start_time time without time zone, p_end_time time without time zone) TO authenticated;
GRANT ALL ON FUNCTION public.quote_court_price(p_booking_date date, p_start_time time without time zone, p_end_time time without time zone) TO service_role;


--
-- Name: FUNCTION reconcile_booking_payment(p_booking_id uuid, p_payment_id uuid, p_stripe_session_id text, p_stripe_payment_intent text, p_amount numeric, p_currency text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.reconcile_booking_payment(p_booking_id uuid, p_payment_id uuid, p_stripe_session_id text, p_stripe_payment_intent text, p_amount numeric, p_currency text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reconcile_booking_payment(p_booking_id uuid, p_payment_id uuid, p_stripe_session_id text, p_stripe_payment_intent text, p_amount numeric, p_currency text) TO service_role;


--
-- Name: FUNCTION record_booking_event(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.record_booking_event() FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_booking_event() TO service_role;


--
-- Name: FUNCTION record_payment_event(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.record_payment_event() FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_payment_event() TO service_role;


--
-- Name: FUNCTION record_settings_change(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.record_settings_change() FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_settings_change() TO service_role;


--
-- Name: FUNCTION reject_gcash_basket(p_basket_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.reject_gcash_basket(p_basket_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reject_gcash_basket(p_basket_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.reject_gcash_basket(p_basket_id uuid) TO service_role;


--
-- Name: FUNCTION release_expired_court_holds(p_court_id uuid, p_booking_date date, p_start_time time without time zone, p_end_time time without time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.release_expired_court_holds(p_court_id uuid, p_booking_date date, p_start_time time without time zone, p_end_time time without time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.release_expired_court_holds(p_court_id uuid, p_booking_date date, p_start_time time without time zone, p_end_time time without time zone) TO service_role;


--
-- Name: FUNCTION request_manual_cash_refund(p_payment_id uuid, p_booking_id uuid, p_amount numeric, p_currency text, p_reason text, p_idempotency_key text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.request_manual_cash_refund(p_payment_id uuid, p_booking_id uuid, p_amount numeric, p_currency text, p_reason text, p_idempotency_key text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.request_manual_cash_refund(p_payment_id uuid, p_booking_id uuid, p_amount numeric, p_currency text, p_reason text, p_idempotency_key text) TO authenticated;
GRANT ALL ON FUNCTION public.request_manual_cash_refund(p_payment_id uuid, p_booking_id uuid, p_amount numeric, p_currency text, p_reason text, p_idempotency_key text) TO service_role;


--
-- Name: FUNCTION reserve_payment_refund(p_payment_id uuid, p_booking_id uuid, p_amount numeric, p_currency text, p_payment_method text, p_reason text, p_idempotency_key text, p_stripe_payment_intent text, p_created_by uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.reserve_payment_refund(p_payment_id uuid, p_booking_id uuid, p_amount numeric, p_currency text, p_payment_method text, p_reason text, p_idempotency_key text, p_stripe_payment_intent text, p_created_by uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reserve_payment_refund(p_payment_id uuid, p_booking_id uuid, p_amount numeric, p_currency text, p_payment_method text, p_reason text, p_idempotency_key text, p_stripe_payment_intent text, p_created_by uuid) TO authenticated;
GRANT ALL ON FUNCTION public.reserve_payment_refund(p_payment_id uuid, p_booking_id uuid, p_amount numeric, p_currency text, p_payment_method text, p_reason text, p_idempotency_key text, p_stripe_payment_intent text, p_created_by uuid) TO service_role;


--
-- Name: FUNCTION save_open_play_schedule(p_id uuid, p_day_of_week text, p_start_time time without time zone, p_end_time time without time zone, p_court_ids uuid[], p_capacity integer, p_price_per_spot numeric); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.save_open_play_schedule(p_id uuid, p_day_of_week text, p_start_time time without time zone, p_end_time time without time zone, p_court_ids uuid[], p_capacity integer, p_price_per_spot numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_open_play_schedule(p_id uuid, p_day_of_week text, p_start_time time without time zone, p_end_time time without time zone, p_court_ids uuid[], p_capacity integer, p_price_per_spot numeric) TO authenticated;
GRANT ALL ON FUNCTION public.save_open_play_schedule(p_id uuid, p_day_of_week text, p_start_time time without time zone, p_end_time time without time zone, p_court_ids uuid[], p_capacity integer, p_price_per_spot numeric) TO service_role;


--
-- Name: FUNCTION save_pricing_settings(p_base_hourly_rate numeric, p_min_hours integer, p_max_hours integer, p_peak_rates jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.save_pricing_settings(p_base_hourly_rate numeric, p_min_hours integer, p_max_hours integer, p_peak_rates jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_pricing_settings(p_base_hourly_rate numeric, p_min_hours integer, p_max_hours integer, p_peak_rates jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.save_pricing_settings(p_base_hourly_rate numeric, p_min_hours integer, p_max_hours integer, p_peak_rates jsonb) TO service_role;


--
-- Name: FUNCTION set_open_play_schedule_active(p_id uuid, p_active boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_open_play_schedule_active(p_id uuid, p_active boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_open_play_schedule_active(p_id uuid, p_active boolean) TO authenticated;
GRANT ALL ON FUNCTION public.set_open_play_schedule_active(p_id uuid, p_active boolean) TO service_role;


--
-- Name: FUNCTION set_staff_access(p_user_id uuid, p_access text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_staff_access(p_user_id uuid, p_access text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_staff_access(p_user_id uuid, p_access text) TO authenticated;
GRANT ALL ON FUNCTION public.set_staff_access(p_user_id uuid, p_access text) TO service_role;


--
-- Name: FUNCTION settle_counter_basket(p_basket_id uuid, p_expected_amount numeric, p_payment_method text, p_payment_reference text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.settle_counter_basket(p_basket_id uuid, p_expected_amount numeric, p_payment_method text, p_payment_reference text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.settle_counter_basket(p_basket_id uuid, p_expected_amount numeric, p_payment_method text, p_payment_reference text) TO authenticated;
GRANT ALL ON FUNCTION public.settle_counter_basket(p_basket_id uuid, p_expected_amount numeric, p_payment_method text, p_payment_reference text) TO service_role;


--
-- Name: FUNCTION settle_counter_payment(p_booking_id uuid, p_payment_id uuid, p_payment_method text, p_payment_reference text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.settle_counter_payment(p_booking_id uuid, p_payment_id uuid, p_payment_method text, p_payment_reference text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.settle_counter_payment(p_booking_id uuid, p_payment_id uuid, p_payment_method text, p_payment_reference text) TO authenticated;
GRANT ALL ON FUNCTION public.settle_counter_payment(p_booking_id uuid, p_payment_id uuid, p_payment_method text, p_payment_reference text) TO service_role;


--
-- Name: FUNCTION settle_stripe_refund(p_refund_request_id uuid, p_stripe_refund_id text, p_stripe_status text, p_stripe_payment_intent text, p_amount numeric, p_currency text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.settle_stripe_refund(p_refund_request_id uuid, p_stripe_refund_id text, p_stripe_status text, p_stripe_payment_intent text, p_amount numeric, p_currency text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.settle_stripe_refund(p_refund_request_id uuid, p_stripe_refund_id text, p_stripe_status text, p_stripe_payment_intent text, p_amount numeric, p_currency text) TO service_role;


--
-- Name: FUNCTION submit_gcash_proof(p_basket_id uuid, p_reference text, p_proof_path text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.submit_gcash_proof(p_basket_id uuid, p_reference text, p_proof_path text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.submit_gcash_proof(p_basket_id uuid, p_reference text, p_proof_path text) TO authenticated;
GRANT ALL ON FUNCTION public.submit_gcash_proof(p_basket_id uuid, p_reference text, p_proof_path text) TO service_role;


--
-- Name: FUNCTION update_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_updated_at() TO anon;
GRANT ALL ON FUNCTION public.update_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.update_updated_at() TO service_role;


--
-- Name: TABLE auth_rate_limits; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.auth_rate_limits TO service_role;


--
-- Name: TABLE booking_events; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.booking_events TO authenticated;
GRANT ALL ON TABLE public.booking_events TO service_role;


--
-- Name: SEQUENCE booking_events_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.booking_events_id_seq TO anon;
GRANT ALL ON SEQUENCE public.booking_events_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.booking_events_id_seq TO service_role;


--
-- Name: TABLE booking_settings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.booking_settings TO service_role;
GRANT SELECT ON TABLE public.booking_settings TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.booking_settings TO authenticated;


--
-- Name: TABLE bookings; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.bookings TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.bookings TO authenticated;
GRANT ALL ON TABLE public.bookings TO service_role;


--
-- Name: TABLE courts; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.courts TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.courts TO authenticated;
GRANT ALL ON TABLE public.courts TO service_role;


--
-- Name: TABLE customers; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.customers TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.customers TO authenticated;
GRANT ALL ON TABLE public.customers TO service_role;


--
-- Name: TABLE payments; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.payments TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.payments TO authenticated;
GRANT ALL ON TABLE public.payments TO service_role;


--
-- Name: TABLE profiles; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.profiles TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;


--
-- Name: COLUMN profiles.full_name; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(full_name) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.phone; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(phone) ON TABLE public.profiles TO authenticated;


--
-- Name: TABLE customer_directory; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.customer_directory TO authenticated;
GRANT ALL ON TABLE public.customer_directory TO service_role;


--
-- Name: TABLE open_play_schedules; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.open_play_schedules TO anon;
GRANT ALL ON TABLE public.open_play_schedules TO authenticated;
GRANT ALL ON TABLE public.open_play_schedules TO service_role;


--
-- Name: TABLE open_play_sessions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.open_play_sessions TO anon;
GRANT ALL ON TABLE public.open_play_sessions TO authenticated;
GRANT ALL ON TABLE public.open_play_sessions TO service_role;


--
-- Name: TABLE operating_hours; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.operating_hours TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.operating_hours TO authenticated;
GRANT ALL ON TABLE public.operating_hours TO service_role;


--
-- Name: TABLE peak_rates; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.peak_rates TO service_role;
GRANT SELECT ON TABLE public.peak_rates TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.peak_rates TO authenticated;


--
-- Name: TABLE pricing_changes; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.pricing_changes TO authenticated;
GRANT ALL ON TABLE public.pricing_changes TO service_role;


--
-- Name: SEQUENCE pricing_changes_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.pricing_changes_id_seq TO anon;
GRANT ALL ON SEQUENCE public.pricing_changes_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.pricing_changes_id_seq TO service_role;


--
-- Name: TABLE refund_requests; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.refund_requests TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.refund_requests TO authenticated;
GRANT ALL ON TABLE public.refund_requests TO service_role;


--
-- Name: TABLE settings_changes; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.settings_changes TO authenticated;
GRANT ALL ON TABLE public.settings_changes TO service_role;


--
-- Name: SEQUENCE settings_changes_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.settings_changes_id_seq TO anon;
GRANT ALL ON SEQUENCE public.settings_changes_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.settings_changes_id_seq TO service_role;


--
-- Name: TABLE venue_closures; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.venue_closures TO anon;
GRANT ALL ON TABLE public.venue_closures TO authenticated;
GRANT ALL ON TABLE public.venue_closures TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- PostgreSQL database dump complete
--

\unrestrict schemasnapshot


-- Outside the public schema: new-user trigger, storage buckets and their access rules
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('club-assets', 'club-assets', 't', 5242880, '{image/jpeg,image/png,image/webp,image/heic}') on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('gcash-receipts', 'gcash-receipts', 'f', 5242880, '{image/jpeg,image/png,image/webp,image/heic}') on conflict (id) do nothing;
create policy club_assets_delete_admin on storage.objects as PERMISSIVE for DELETE to authenticated using (((bucket_id = 'club-assets'::text) AND public.is_owner()));
create policy club_assets_insert_admin on storage.objects as PERMISSIVE for INSERT to authenticated with check (((bucket_id = 'club-assets'::text) AND public.is_owner()));
create policy club_assets_select_all on storage.objects as PERMISSIVE for SELECT to public using ((bucket_id = 'club-assets'::text));
create policy club_assets_update_admin on storage.objects as PERMISSIVE for UPDATE to authenticated using (((bucket_id = 'club-assets'::text) AND public.is_owner())) with check (((bucket_id = 'club-assets'::text) AND public.is_owner()));
create policy gcash_receipts_delete_admin on storage.objects as PERMISSIVE for DELETE to authenticated using (((bucket_id = 'gcash-receipts'::text) AND public.is_admin()));
create policy gcash_receipts_insert_own on storage.objects as PERMISSIVE for INSERT to authenticated with check (((bucket_id = 'gcash-receipts'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
create policy gcash_receipts_select_admin on storage.objects as PERMISSIVE for SELECT to authenticated using (((bucket_id = 'gcash-receipts'::text) AND public.is_admin()));
