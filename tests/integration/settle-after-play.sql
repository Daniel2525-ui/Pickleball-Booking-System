-- Self-check for settle_counter_payment after play. Local stack only, everything rolled back:
--   docker exec -i supabase_db_localdb psql -U postgres -v ON_ERROR_STOP=1 < tests/integration/settle-after-play.sql
BEGIN;
DO $$
DECLARE
  v_admin uuid := (SELECT id FROM public.profiles WHERE role = 'admin' LIMIT 1);
  v_court uuid := (SELECT id FROM public.courts WHERE status = 'active' LIMIT 1);
  v_b uuid; v_p uuid; v_status text;
  v_new_status text; v_new_pay text;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  -- One booking per status, all on a past date with a pending payment
  FOREACH v_status IN ARRAY ARRAY['completed', 'confirmed', 'checked_in', 'in_progress', 'no_show', 'cancelled', 'pending'] LOOP
    INSERT INTO public.bookings (user_id, court_id, booking_date, start_time, end_time, total_amount, customer_name, status, hold_expires_at)
    VALUES (v_admin, v_court, DATE '2020-01-06', '08:00', '09:00', 255, 'Settle check ' || v_status,
            v_status,
            CASE WHEN v_status = 'pending' THEN now() + interval '10 minutes' END)
    RETURNING id INTO v_b;
    -- The overlap constraint allows only one active booking per hour; release it after each case
    INSERT INTO public.payments (booking_id, amount, status) VALUES (v_b, 255, 'pending') RETURNING id INTO v_p;

    BEGIN
      PERFORM public.settle_counter_payment(v_b, v_p, 'cash', 'REC-1');
      SELECT b.status, p.status INTO v_new_status, v_new_pay FROM public.bookings b JOIN public.payments p ON p.booking_id = b.id WHERE b.id = v_b;
      IF v_status IN ('completed', 'confirmed', 'checked_in', 'in_progress') THEN
        ASSERT v_new_pay = 'paid', v_status || ': payment should be paid, got ' || v_new_pay;
        ASSERT v_new_status = v_status, v_status || ': booking status must not change, got ' || v_new_status;
      ELSE
        RAISE EXCEPTION 'CHECK FAILED: % should have been refused', v_status;
      END IF;
    EXCEPTION WHEN assert_failure THEN RAISE;
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'CHECK FAILED%' THEN RAISE; END IF;
      IF v_status IN ('no_show', 'cancelled') THEN
        ASSERT SQLERRM LIKE 'INVALID_STATUS%', v_status || ': expected INVALID_STATUS, got ' || SQLERRM;
      ELSIF v_status = 'pending' THEN
        ASSERT SQLERRM LIKE 'MATCH_START_PASSED%', 'pending past slot: expected MATCH_START_PASSED, got ' || SQLERRM;
      ELSE
        RAISE EXCEPTION '%: unexpected refusal: %', v_status, SQLERRM;
      END IF;
    END;
    UPDATE public.bookings SET status = 'cancelled' WHERE id = v_b;
  END LOOP;
  RAISE NOTICE 'settle-after-play: all checks passed';
END $$;
ROLLBACK;
