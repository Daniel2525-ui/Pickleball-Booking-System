# GCash Manual Payment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Players choose Card or GCash at checkout. GCash is a manual transfer: the player submits a reference number and a receipt screenshot, and an admin approves or rejects it. Admins edit the club's GCash details on a new Settings page.

**Architecture:** "Awaiting verification" means a `pending` booking whose `hold_expires_at = 'infinity'`. Every existing rule already keys on that column, so no existing RPC changes:
- the overlap check, `hold_release_after`, public availability and `OPEN_BASKET_EXISTS` keep the slot occupied and keep the one-open-basket rule;
- the cron (`hold_expires_at <= now`) and `cancel_expired_booking` (`HOLD_NOT_EXPIRED`) skip it;
- `ALLOWED_TRANSITIONS.pending = ["cancelled"]` already blocks check-in.

Four new RPCs (hold, submit, approve, reject) do the GCash work. The existing `/api/stripe/checkout` route takes a `payment_method` and, for GCash, returns a redirect to the pay page instead of opening Stripe.

**Tech Stack:** Next.js 16.3 (read `node_modules/next/dist/docs/` before writing routes or pages), Supabase Postgres + Storage, `node --test` unit tests, the Docker Postgres integration runner.

**Spec:** `docs/superpowers/specs/2026-10-31-gcash-manual-payment-design.md`

## Global Constraints

- Card / Stripe behaviour is unchanged. GCash baskets never call `openBasketCheckout`, and `reconcile_booking_payment` already ignores `payment_method = 'gcash'`.
- `payment_method` value for online GCash: `'gcash'`. This is the same value counter settlement uses.
- Amounts always come from the server's `bookings.total_amount`, never from the client.
- Receipt screenshots live in a private bucket. Only admins read them, through signed URLs.
- New SQL functions use `SECURITY DEFINER`, `SET search_path TO ''`, `REVOKE ALL ... FROM PUBLIC, anon` and `GRANT EXECUTE ... TO authenticated, service_role`, matching `multi_court_basket.sql`.
- Each migration ships a rollback in `supabase/rollback_<name>.sql`, following the existing pattern.
- Status label copy: **"Awaiting verification"**. Reject reason copy (player-facing): **"GCash payment could not be verified"**.

## Review Focus

1. **Proof submitted just as the 30-minute hold runs out** (a race with the cron). Expected: `submit_gcash_proof` locks the rows and refuses with `HOLD_EXPIRED`. It never revives a slot. Test in Task 1.
2. **Double-clicked Submit.** Expected: the second call fails with `ALREADY_SUBMITTED` and nothing changes. Test in Task 1.
3. **One court of the basket cancelled before approve.** Expected: approve confirms only the courts still pending, and `amount` is their sum. Test in Task 2.
4. **A receipt path pointing into another user's folder.** Expected: `INVALID_ARGUMENT`. Test in Task 1.
5. **A player cancelling an awaiting booking by writing to the table directly** (RLS bypass of the route). Expected: 0 rows updated. Test in Task 1.

---

### Task 1: Database — GCash hold and proof submission

**Files:**
- Create: `supabase/migrations/20261031120000_gcash_manual_payment.sql`
- Create: `supabase/rollback_gcash_manual_payment.sql`
- Test: `tests/integration/run-pg-integration.mjs` (append before the final `ALL INTEGRATION TESTS PASSED` log)

**Interfaces:**
- Produces:
  - Columns `booking_settings.gcash_account_name text`, `gcash_number text` and `gcash_qr_url text`, all nullable. CHECK: both name and number are null, or both are set. Name length is 1–100. Number matches `^09[0-9]{9}$`.
  - Columns `payments.gcash_proof_path text` and `payments.gcash_submitted_at timestamptz`.
  - `bookings_cancel_reason_check` extended with `'gcash_rejected'`.
  - `hold_gcash_basket(p_booking_date date, p_lines jsonb, p_hold_expires_at timestamptz DEFAULT NULL) RETURNS jsonb`: same return shape as `hold_court_basket`.
  - `submit_gcash_proof(p_basket_id uuid, p_reference text, p_proof_path text) RETURNS jsonb`: returns `{basket_id, submitted}`.

- [ ] **Step 1: Write the failing integration test** `"gcash: hold, proof submission, and the slot stays held"`. Apply `multi_court_basket` and then `gcash_manual_payment`, the same way the last test does. Use a fresh date (`2030-02-12`, a Tuesday) and dana's uid, after expiring dana's leftover holds. Assert:
  - When booking_settings has no GCash details, `hold_gcash_basket` raises `GCASH_NOT_CONFIGURED`. Set the details before going on.
  - `hold_gcash_basket` for two courts returns `basket_id` and `items` with 2 rows. Both payments have `payment_method = 'gcash'` and status `pending`.
  - `submit_gcash_proof` raises `INVALID_ARGUMENT` in each of these cases, and state stays unchanged:
    - reference `'abc'` (too short);
    - proof path `'<bobUid>/x.png'` (not the caller's folder);
    - proof path `'<danaUid>/../x.png'`.
  - Called as bob on dana's basket, it raises `NOT_FOUND`.
  - The valid call is reference `'1234 5678 90123'` with path `'<danaUid>/<basket>.png'`. It returns `{submitted: 2}`. Every booking in the basket then has `hold_expires_at = 'infinity'`. Every payment has `payment_reference = '1234567890123'` (spaces stripped) and a non-null `gcash_proof_path` and `gcash_submitted_at`.
  - A second identical call raises `ALREADY_SUBMITTED`.
  - Slot still held: bob's `hold_court_basket` on the same court and time raises `SLOT_UNAVAILABLE`. Calling `release_expired_court_holds` for the court and day leaves both bookings `pending`.
  - Cron skip: `cancel_expired_booking(<booking_id>)`, called as `service_role`, returns `reason = 'HOLD_NOT_EXPIRED'`.
  - One open basket: dana's `hold_court_basket` on another hour raises `OPEN_BASKET_EXISTS`.
  - RLS: as dana, `UPDATE public.bookings SET status='cancelled' WHERE basket_id=...` updates 0 rows.
  - Race: a new basket for alice, with `hold_expires_at` set to `now() - interval '1 second'`, gets `HOLD_EXPIRED` from `submit_gcash_proof`.
  - The rollback file drops all four functions (`to_regproc` is null), and the migration then re-applies cleanly.

- [ ] **Step 2: Run** `npm run test:integration`. Expected: FAIL at `hold_gcash_basket` (function does not exist).

- [ ] **Step 3: Write the migration.**
  - **`hold_gcash_basket`:**
    - Raise `GCASH_NOT_CONFIGURED` (P0001) when `gcash_number` is null.
    - Otherwise assign `v := public.hold_court_basket(p_booking_date, p_lines, p_hold_expires_at)`, then `UPDATE payments SET payment_method='gcash'` for the ids in `v->'items'`, then return `v`. `auth.uid()` carries through to the nested call.
  - **`submit_gcash_proof`:**
    1. Require `auth.uid()`.
    2. Normalise the reference with `regexp_replace(p_reference, '[\s-]', '', 'g')`. It must match `^[A-Za-z0-9]{6,20}$`.
    3. `p_proof_path` must start with `auth.uid()::text || '/'`, must not contain `..`, and must be at most 300 chars.
    4. Lock the caller's `pending` bookings in the basket with `ORDER BY court_id FOR UPDATE`. If there are none, raise `NOT_FOUND`.
    5. If any of them has `hold_expires_at = 'infinity'`, raise `ALREADY_SUBMITTED`.
    6. If any hold has expired (`coalesce(hold_expires_at, created_at + 35 min) <= clock_timestamp()`), raise `HOLD_EXPIRED`.
    7. If any payment is not `gcash`/`pending`, raise `INVALID_STATUS`.
    8. Otherwise update the payments and set the bookings' `hold_expires_at = 'infinity'`.
  - **Customer update RLS:** recreate `bookings_update_policy` from `20261029040611_customer_cancel_pending_only.sql`, changing the customer `USING` arm to `(user_id = auth.uid() AND status = 'pending' AND hold_expires_at IS DISTINCT FROM 'infinity')`.
  - **Rollback:** reverse the columns, constraint, policy and functions.

- [ ] **Step 4: Run** `npm run test:integration`. Expected: PASS, including every earlier test.

- [ ] **Step 5: Commit** with the message `feat(db): GCash hold and proof submission`.

### Task 2: Database — approve and reject

**Files:**
- Modify: `supabase/migrations/20261031120000_gcash_manual_payment.sql`, `supabase/rollback_gcash_manual_payment.sql`
- Test: `tests/integration/run-pg-integration.mjs`

**Interfaces:**
- Consumes: Task 1's columns and `submit_gcash_proof`.
- Produces:
  - `approve_gcash_basket(p_basket_id uuid) RETURNS jsonb`: returns `{basket_id, approved, amount}`.
  - `reject_gcash_basket(p_basket_id uuid) RETURNS jsonb`: returns `{basket_id, rejected}`.

- [ ] **Step 1: Write the failing test** `"gcash: admin approves or rejects a whole basket"`. Use date `2030-02-19`. Build a basket with dana, then call `submit_gcash_proof`. Assert:
  - bob gets `FORBIDDEN` for both functions.
  - A basket that was never submitted gets `NOT_FOUND`.
  - After setting the bookings' `booking_date` to yesterday (so the start has passed), the admin's approve still succeeds. Both rows become `confirmed/paid/gcash`, with `hold_expires_at` null and `paid_at` set.
  - Partial basket: cancel one court of a second submitted basket, then approve it. The result is `approved = 1`, `amount` equals that court's `total_amount`, and the cancelled court stays cancelled.
  - Reject on a third submitted basket: both bookings become `cancelled`, with `cancel_reason = 'gcash_rejected'` and payments `failed`. Bob can then hold that slot.
  - Approve or reject on an already-decided basket raises `NOT_FOUND`.

- [ ] **Step 2: Run** `npm run test:integration`. Expected: FAIL (function does not exist).

- [ ] **Step 3: Add both functions to the migration.**
  - Both require admin, using the same `profiles.role = 'admin'` check as `settle_counter_payment`.
  - Both lock the basket's bookings with `status='pending' AND hold_expires_at='infinity'` and their payments with `gcash_submitted_at IS NOT NULL`, in court order. If nothing matches, raise `NOT_FOUND`.
  - **Approve** sets payments `status='paid', paid_at=now`, and bookings `status='confirmed', hold_expires_at=NULL, updated_at=now`. It deliberately does **not** check start time or hold expiry.
  - **Reject** sets bookings `status='cancelled', cancel_reason='gcash_rejected'` and payments `status='failed'`.
  - Extend the rollback to drop both functions.

- [ ] **Step 4: Run** `npm run test:integration`. Expected: PASS.

- [ ] **Step 5: Commit** with the message `feat(db): approve and reject GCash payments`.

### Task 3: Storage buckets

**Files:**
- Create: `supabase/migrations/20261031120100_gcash_storage.sql`
- Create: `supabase/rollback_gcash_storage.sql`

This migration is not applied by the integration runner, because its plain Postgres has no `storage` schema.

**Interfaces:**
- Produces:
  - Bucket `gcash-receipts`: private, `file_size_limit` 5242880, `allowed_mime_types` `{image/jpeg,image/png,image/webp,image/heic}`.
  - Bucket `club-assets`: public, same limit and types.

- [ ] **Step 1: Write the migration.**
  - `INSERT INTO storage.buckets ... ON CONFLICT (id) DO UPDATE` for both buckets.
  - Policies on `storage.objects`:
    - `gcash-receipts`: an authenticated user may INSERT where `(storage.foldername(name))[1] = auth.uid()::text`. SELECT and DELETE only when `public.is_admin()`.
    - `club-assets`: anyone may SELECT. INSERT, UPDATE and DELETE only when `public.is_admin()`.
  - Write the rollback.

- [ ] **Step 2: Apply it to the staging project** using the procedure in `docs/superpowers/plans/2026-10-24-supabase-staging-verification-plan.md`. Never apply to production from this plan. Verify there in SQL:
  - an authenticated non-admin cannot select from `gcash-receipts`;
  - an insert outside the user's own folder is refused.

  Also apply Task 1 and Task 2's migration to staging, and confirm a PostgREST read of an awaiting booking returns `"hold_expires_at": "infinity"`. Task 4 depends on that exact string.

- [ ] **Step 3: Commit** with the message `feat(db): storage buckets for GCash receipts and club QR`.

### Task 4: Awaiting-verification status in shared helpers

**Files:**
- Modify: `src/lib/services/bookings/bookingDisplayStatus.ts`, `src/lib/services/bookings/cancelBooking.service.ts`, `src/lib/services/bookings/bookingsTypes.ts`
- Test: `tests/booking-display-status.test.mjs`, plus the existing cancel-rule tests in `tests/booking-rules.test.mjs`

**Interfaces:**
- Produces:
  - `isAwaitingVerification(booking: HoldFields): boolean`, true when `status === "pending" && hold_expires_at === "infinity"`.
  - `getBookingDisplayStatus` returns `"awaiting_verification"` for those bookings.
  - `BookingPayment` gains `gcash_proof_path?: string | null` and `gcash_submitted_at?: string | null`.

- [ ] **Step 1: Write the failing tests.**
  - `"awaiting verification: infinite hold is never expired and shows its own status"`: `getBookingDisplayStatus(booking({ hold_expires_at: "infinity" }), now) === "awaiting_verification"` and `isHoldExpired(...) === false`.
  - In `booking-rules.test.mjs`: `getCancellationBlockReason({ status: "pending", hold_expires_at: "infinity", booking_date, start_time }, now)` equals `"Your GCash payment is being verified. Please contact the club to cancel."`

- [ ] **Step 2: Run** `npm test`. Expected: the two new tests FAIL.

- [ ] **Step 3: Implement.** Add `hold_expires_at?: string | null` to `CancellableBookingFields`. Then make sure `/api/bookings/cancel` selects that field; it already does.

- [ ] **Step 4: Run** `npm test`. Expected: PASS.

- [ ] **Step 5: Commit** with the message `feat(booking): awaiting-verification display status`.

### Task 5: Checkout choice and resume

**Files:**
- Modify: `src/app/api/stripe/checkout/route.ts`, `src/lib/services/payments/createCheckoutSession.service.ts`, `src/components/customers/booking-modal.tsx`, `src/components/customers/booking-container.tsx`, `src/app/api/bookings/resume-payment/route.ts`, `src/components/customers/booking-history-container.tsx`
- Test: `tests/e2e/basket.spec.mjs` (extend it), following the local-db helpers in `tests/e2e/local-db.mjs`

**Interfaces:**
- Consumes: `hold_gcash_basket` from Task 1, `isAwaitingVerification` from Task 4.
- Produces:
  - `createCheckoutSession({ date, lines, paymentMethod }: { ...; paymentMethod: "card" | "gcash" }): Promise<string>`, returning the URL to navigate to.
  - GCash pay page URL: `/book/gcash?basket=<basket_id>`.

- [ ] **Step 1: Write the failing e2e test** `"GCash checkout lands on the pay page; GCash hidden when not configured"`.
  - With booking_settings GCash details empty, the booking modal shows no GCash option.
  - With details set: pick a slot, choose GCash, confirm. The URL matches `/book/gcash?basket=`, and the payments rows have `payment_method = 'gcash'`.

- [ ] **Step 2: Run** `npm run test:e2e -- basket`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - **Checkout route:**
    - Read `payment_method` from the body. Only `"gcash"` changes behaviour; anything else is card.
    - Extend the existing `booking_settings` select with `gcash_number`. If GCash was requested but the number is null, return 400 `"GCash payments are not available right now."`.
    - Call `supabase.rpc(isGcash ? "hold_gcash_basket" : "hold_court_basket", sameArgs)`.
    - After the existing items check, GCash returns `{ url: "/book/gcash?basket=" + basket_id }` and skips step 4.
  - **BookingModal:** gets `gcashEnabled: boolean` and an `onConfirm(paymentMethod)`. It shows a two-option Card / GCash choice, defaulting to Card, only when `gcashEnabled` is true.
  - **booking-container:** reads `gcash_account_name, gcash_number` from `booking_settings` next to `fetchPricing`.
  - **Resume route:** if the booking's payment `payment_method` is `'gcash'`, return `{ url: "/book/gcash?basket=" + basket_id }` before any Stripe work.
  - **booking-history-container:** change the toast from "Redirecting to secure Stripe checkout..." to "Redirecting to payment...". Pass `holdExpiresAt` to the countdown only when `!isAwaitingVerification(booking)`. Show the "Awaiting verification" label, with the same amber style used for pending. For a cancelled booking with `cancel_reason === "gcash_rejected"`, show "GCash payment could not be verified" under the status.
  - **booking-container:** when the player's open hold `isAwaitingVerification`, the unpaid-hold banner (the "Pay before it expires" text near line 433) says "Your GCash payment is being verified. You can book again once the club confirms it." and offers no pay or cancel action.

- [ ] **Step 4: Run** `npm run test:e2e -- basket`, then `npm test`. Expected: PASS.

- [ ] **Step 5: Commit** with the message `feat(booking): choose Card or GCash at checkout`.

### Task 6: GCash pay page

**Files:**
- Create: `src/app/(customer)/book/gcash/page.tsx`, `src/components/customers/gcash-payment-container.tsx`
- Test: `tests/e2e/basket.spec.mjs`

**Interfaces:**
- Consumes: `submit_gcash_proof` (Task 1), bucket `gcash-receipts` (Task 3), `isAwaitingVerification` (Task 4).

- [ ] **Step 1: Write the failing e2e test** `"GCash pay page submits reference and screenshot"`.
  - On the page from Task 5, Submit stays disabled until both a reference and an image are provided.
  - After submitting a 1×1 PNG fixture and `1234567890123`, the page shows "Payment submitted".
  - `/my-bookings` shows "Awaiting verification" for each court.

- [ ] **Step 2: Run** `npm run test:e2e -- basket`. Expected: FAIL (404).

- [ ] **Step 3: Implement** a client container that loads the caller's basket rows (RLS limits rows to the owner) and `booking_settings`. Layout is the one-page version from the spec:
  - "Send exactly ₱{sum of total_amount}", the QR image when `gcash_qr_url` is set, the account name, and the number with a copy button.
  - The required reference input and the required image input. Check client-side for `image/*` and ≤5 MB; the bucket enforces the same.
  - Upload to `gcash-receipts/${user.id}/${basketId}-${Date.now()}.${ext}`, then call `rpc("submit_gcash_proof", ...)`.
  - The page has three states:
    - already awaiting: the confirmation view;
    - hold expired or basket not found: "This reservation has expired" with a link to `/book`;
    - a `HOLD_EXPIRED` RPC error: the same expired message.

- [ ] **Step 4: Run** `npm run test:e2e -- basket`. Expected: PASS.

- [ ] **Step 5: Commit** with the message `feat(booking): GCash pay page`.

### Task 7: Admin verification

**Files:**
- Create: `src/app/api/admin/payments/gcash-verify/route.ts`, `src/lib/services/payments/verifyGcashPayment.service.ts`, `src/components/admin/bookings/verifyGcashModal.tsx`
- Modify: `src/lib/services/bookings/filterBookingsData.service.ts`, `src/components/admin/bookings/booking-filters.tsx`, `src/components/admin/bookings/bookings-table.tsx`
- Test: `tests/e2e/admin-walk-in.spec.mjs` (extend it), or a new `tests/e2e/admin-gcash.spec.mjs` using the same login helpers

**Interfaces:**
- Consumes: `approve_gcash_basket` / `reject_gcash_basket` (Task 2), `isAwaitingVerification` (Task 4).
- Produces:
  - `POST /api/admin/payments/gcash-verify` with body `{ basketId: string, action: "approve" | "reject" }`. Responses: 200 `{ ok: true }`; 403 for a non-admin; 404 on `NOT_FOUND`.
  - `verifyGcashPayment(basketId, action): Promise<{ error: Error | null }>`.

- [ ] **Step 1: Write the failing e2e test** `"admin approves and rejects GCash payments"`.
  - Seed two submitted baskets through SQL in local-db.
  - The admin selects the "Awaiting Verification" filter and sees both.
  - Verify shows the reference and a loaded image.
  - Approve turns one into Confirmed. Reject turns the other into Cancelled.
  - A non-admin POST to the route gets 403.

- [ ] **Step 2: Run** `npm run test:e2e -- admin-gcash`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - **Route:** authenticate like `/api/admin/payments/settle` does, validate `action`, call the RPC with the user's client, and map the errors.
  - **filterBookingsData:** add `basket_id, gcash_proof_path, gcash_submitted_at` to the select. The filter value `"awaiting verification"` becomes `.eq("status","pending").eq("hold_expires_at","infinity")`.
  - **booking-filters:** add the "Awaiting Verification" option, with a count from a `head: true, count: "exact"` query using the same two filters.
  - **bookings-table:** add a `STATUS_LABELS` and `statusStyles` entry for `awaiting_verification`, and a "Verify" row action when `isAwaitingVerification(booking)`.
  - **verifyGcashModal:**
    - Shows the customer, court count and expected total from `counterSettlementDue`, the screenshot via `createSignedUrl(path, 300)`, the reference, and the submitted time.
    - Warns "This reference was also used on another booking" when another payment with the same `payment_reference` and `payment_method = 'gcash'` exists.
    - Has "Reject & release slots" (destructive style) and "Approve — mark paid" buttons.
    - On success it updates every row of the basket in local state, the way `handlePaymentSettled` does.

- [ ] **Step 4: Run** `npm run test:e2e -- admin-gcash`, then `npm test`. Expected: PASS.

- [ ] **Step 5: Commit** with the message `feat(admin): verify GCash payments`.

### Task 8: Admin Settings page

**Files:**
- Create: `src/app/(admin)/admin/settings/page.tsx`, `src/components/admin/settings/settings-container.tsx`
- Modify: `src/components/admin/AppSidebar` (the file with the `title`/`url` nav items)
- Test: `tests/e2e/admin-gcash.spec.mjs`

**Interfaces:**
- Consumes: the `booking_settings` GCash columns (Task 1) and bucket `club-assets` (Task 3).

- [ ] **Step 1: Write the failing e2e test** `"admin edits GCash details"`.
  - A "Settings" sidebar link opens `/admin/settings`.
  - Saving the name "Pickle Club Co." and the number `09171234567` persists across a reload.
  - The number `12345` shows a validation error and nothing is saved.
  - Clearing both fields hides GCash in the player booking modal (this reuses Task 5's check).

- [ ] **Step 2: Run** `npm run test:e2e -- admin-gcash`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - The page header follows the style of `admin/pricing/page.tsx`.
  - The form has the account name, the number (strip spaces before saving, validate `^09\d{9}$` on the client), and a QR upload to `club-assets/gcash-qr-${Date.now()}.${ext}` that stores the public URL in `gcash_qr_url`, plus a "Remove QR" action.
  - Save with `from("booking_settings").update({...}).eq("id", true)`. The existing admin RLS policy and Task 1's CHECK constraints are the server-side guard; show their error message on failure.
  - Add the sidebar item `{ title: "Settings", url: "/admin/settings" }` with the lucide `Settings` icon, after "Payments & Revenue".

- [ ] **Step 4: Run** `npm run test:e2e -- admin-gcash`, `npm test`, `npm run lint` and `npm run build`. Expected: all PASS.

- [ ] **Step 5: Commit** with the message `feat(admin): Settings page for GCash details`.
