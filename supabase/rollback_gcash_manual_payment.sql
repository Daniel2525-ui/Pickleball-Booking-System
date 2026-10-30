-- Rollback: gcash_manual_payment — drops the GCash functions and columns and restores the customer update policy
-- and cancel_reason check. Fails if a booking has cancel_reason 'gcash_rejected': change it first.
-- Submitted bookings (hold_expires_at = 'infinity') are left as they are: confirm or cancel them first.
BEGIN;

DROP FUNCTION IF EXISTS public.submit_gcash_proof(uuid, text, text);
DROP FUNCTION IF EXISTS public.hold_gcash_basket(date, jsonb, timestamptz);

DROP POLICY IF EXISTS bookings_update_policy ON public.bookings;
CREATE POLICY bookings_update_policy ON public.bookings
  FOR UPDATE
  USING (
    coalesce(auth.role(), '') = 'service_role'
    OR (current_user = 'postgres' AND auth.role() IS NULL)
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    OR (user_id = auth.uid() AND status = 'pending')
  )
  WITH CHECK (
    coalesce(auth.role(), '') = 'service_role'
    OR (current_user = 'postgres' AND auth.role() IS NULL)
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    OR (user_id = auth.uid() AND status = 'cancelled')
  );

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_cancel_reason_check;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_cancel_reason_check CHECK (
  cancel_reason IS NULL
  OR cancel_reason IN ('expired', 'customer', 'admin', 'checkout_failed', 'slot_conflict', 'court_unavailable', 'start_passed')
);

ALTER TABLE public.payments DROP COLUMN IF EXISTS gcash_proof_path, DROP COLUMN IF EXISTS gcash_submitted_at;
ALTER TABLE public.booking_settings DROP CONSTRAINT IF EXISTS booking_settings_gcash_check;
ALTER TABLE public.booking_settings DROP COLUMN IF EXISTS gcash_account_name, DROP COLUMN IF EXISTS gcash_number, DROP COLUMN IF EXISTS gcash_qr_url;

COMMIT;
