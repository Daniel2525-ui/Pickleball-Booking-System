# Multi-Court Basket Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a signed-in customer hold several courts on one date in one all-or-nothing hold, pay once through Stripe, and later cancel/refund each court on its own.

**Architecture:** A basket is a set of ordinary `bookings` rows sharing a new `bookings.basket_id`; each keeps its own `payments` row with that court's amount, and all of a basket's payment rows carry the same Stripe session id and payment intent (the per-payment unique indexes become unique per booking). Every existing per-booking path (reconcile, cancel, refund ledger, cron, admin status) keeps working per row; new code only groups rows by `basket_id` where the spec says "whole basket". Single-court checkout becomes a basket of one through a new `hold_court_basket` RPC that calls `hold_court_booking` per line in one transaction.

**Tech Stack:** Next.js 16 route handlers, Supabase Postgres (plpgsql, RLS), Stripe Checkout, node:test, Playwright, `tests/integration/run-pg-integration.mjs` (Docker Postgres).

**Spec:** `docs/superpowers/specs/2026-10-29-multi-court-basket-design.md`

## Global Constraints

- One date per basket; one line per court; a basket may include every court.
- All or nothing: any failing line aborts the whole hold; the error names the court and time.
- One open (unpaid, unexpired) basket per customer; refuse a new checkout with `OPEN_BASKET_EXISTS` until it is paid, cancelled or expired. Replaces `TOO_MANY_HOLDS` (3 open holds). Service role is not limited (same scope as today's check).
- Amount per line = `public.quote_court_price(date, start, end)`; durations within `booking_settings.min_hours..max_hours`. Client never decides the amount.
- Paid basket: each court is independent (cancel up to `CANCELLATION_CUTOFF_HOURS` = 2 before its start, refund = that court's `payments.amount` only).
- Unpaid basket: resume, customer cancel, staff cancel and staff collect act on every pending court of the basket; `cancel_reason` rules unchanged (`customer`/`admin`, or `expired` if the hold had timed out).
- Hold length, 20-minute grace (`hold_release_after`), cron cleanup, `checkout.session.expired` handling unchanged and per basket.
- Old Stripe sessions with `metadata.booking_id`/`payment_id` (no `basket_id`) must still verify, reconcile and expire.
- Walk-ins stay single court (`create_walk_in_booking` untouched).
- Schema changes go in ONE migration `supabase/migrations/multi_court_basket.pending.sql` + `supabase/rollback_multi_court_basket.sql`, built from the LIVE function bodies: first run `npx supabase db dump --linked --workdir <scratch>/localdb -f <scratch>/localdb/prod_schema.sql` (the CLI is logged in; scratch workdir as in earlier sessions) and copy `hold_court_booking`, `reconcile_booking_payment`, `settle_counter_payment` from it, changing only the lines this plan names. Apply locally only; production apply is a separate, owner-approved step, migration before app deploy.

## Review Focus

1. Two customers checking out overlapping baskets at the same moment (e.g. A: Courts 1+2, B: Courts 2+3) must not deadlock and must leave one of them with nothing held. Owned by Task 2 (concurrency test).
2. Stripe webhook and success-page verify both arriving for the same basket must not double-confirm or create duplicate payment rows. Owned by Task 4 (redelivery test).
3. Cancelling one paid court twice (double click / retry) must refund it once. Owned by Task 6 (existing conditional update + refund idempotency key `ref_customer_cancel_<payment_id>`; add a repeat-call assertion).
4. A customer with a legacy pending hold (no `basket_id`, created before deploy) must count as an open basket and be resumable/cancellable alone. Owned by Task 2 and Task 6 (`coalesce(basket_id, id)` grouping).
5. Removing the last line from the basket sheet, or changing date mid-selection, must leave no stale "Continue to Checkout". Owned by Task 7 (UI test).

---

### Task 1: Schema: `basket_id`, per-booking Stripe uniques, reconcile duplicate lookup

**Files:**
- Create: `supabase/migrations/multi_court_basket.pending.sql` (sections 1–2), `supabase/rollback_multi_court_basket.sql`
- Test: `tests/integration/run-pg-integration.mjs` (new `runTest` at the end, before the summary)

**Interfaces:**
- Produces: column `bookings.basket_id uuid NULL` with index `idx_bookings_basket_id`; unique indexes `uq_payments_session_per_booking (stripe_session_id, booking_id) WHERE stripe_session_id IS NOT NULL` and `uq_payments_intent_per_booking (stripe_payment_id, booking_id) WHERE stripe_payment_id IS NOT NULL` replacing constraint `payments_stripe_session_id_key` and index `idx_payments_stripe_payment_id`.
- `reconcile_booking_payment`: in Subcase 1.3 every `WHERE stripe_payment_id = p_stripe_payment_intent` also filters `AND booking_id = p_booking_id`; the unique-violation handler accepts constraint `uq_payments_intent_per_booking` instead of `idx_payments_stripe_payment_id`.

- [ ] **Step 1: Write the failing integration test** `multi_court_basket: sibling payments share a Stripe session and intent`: insert two pending bookings with the same `basket_id` and two pending payments; set both payments' `stripe_session_id = 'cs_shared'`; reconcile booking A then booking B with `pi_shared` (service role) and assert both bookings `confirmed`, both payments `paid` with `stripe_payment_id = 'pi_shared'`; reconcile A again → `action = 'NO_OP'`; and a second payment row with the same intent for the SAME booking is still rejected (unique).
- [ ] **Step 2: Run** `node tests/integration/run-pg-integration.mjs` → Expected: FAIL (unique violation on `payments_stripe_session_id_key`).
- [ ] **Step 3: Write migration sections 1–2** (column + index, unique swap, reconcile with the two changes above; idempotent: `ADD COLUMN IF NOT EXISTS`, `DROP ... IF EXISTS`, `CREATE UNIQUE INDEX IF NOT EXISTS`) and the matching rollback (restore original reconcile body, original uniques, drop column). Test applies the migration file inside the test like the existing `booking_cancel_reason` test.
- [ ] **Step 4: Run** integration → Expected: PASS, all prior checks still pass.
- [ ] **Step 5: Commit** `feat(db): basket_id and per-booking Stripe ids`

### Task 2: All-or-nothing basket hold and the one-open-basket rule

**Files:**
- Modify: `supabase/migrations/multi_court_basket.pending.sql` (section 3), rollback
- Test: `tests/integration/run-pg-integration.mjs`

**Interfaces:**
- Consumes: `bookings.basket_id` (Task 1).
- Produces:
  - `hold_court_booking(p_court_id uuid, p_booking_date date, p_start_time time, p_end_time time, p_user_id uuid, p_amount numeric, p_hold_expires_at timestamptz DEFAULT NULL, p_basket_id uuid DEFAULT NULL) RETURNS jsonb` — DROP the 7-arg version first, re-GRANT `authenticated, service_role`. Inserts `basket_id = coalesce(p_basket_id, gen_random_uuid())`; returns existing keys plus `basket_id`. Replaces the `TOO_MANY_HOLDS` block (non-service callers) with: raise `'OPEN_BASKET_EXISTS: Finish or cancel your reservation awaiting payment before starting another'` if the user has any `pending` booking with `coalesce(hold_expires_at, created_at + interval '35 minutes') > clock_timestamp()` and `coalesce(basket_id, id) IS DISTINCT FROM p_basket_id`.
  - `hold_court_basket(p_booking_date date, p_lines jsonb, p_hold_expires_at timestamptz DEFAULT NULL) RETURNS jsonb` (SECURITY DEFINER, `search_path = ''`, GRANT `authenticated, service_role`). `p_lines` = array of `{court_id, start_time, end_time}` (1 ≤ length ≤ count of courts). Rejects duplicate `court_id` with `INVALID_ARGUMENT: Each court can appear once per booking`. Generates one basket id, calls `hold_court_booking(..., p_amount => NULL, p_basket_id => v_basket)` for each line **ordered by court_id**; on `SLOT_UNAVAILABLE` from a line re-raises `'SLOT_UNAVAILABLE: <court name> <HH:MI AM>–<HH:MI AM>'`. Returns `{basket_id, hold_expires_at, total, items: [{booking_id, payment_id, court_id, court_name, start_time, end_time, amount}]}`.

- [ ] **Step 1: Write failing tests** (one `runTest`): (a) basket of Courts A+B succeeds, both bookings share `basket_id`, `total` = sum of `quote_court_price`; (b) basket where line 2 overlaps a confirmed booking fails with message containing that court's name, and **no** booking from the basket exists afterwards; (c) duplicate court rejected; (d) second basket by same user while first is open → `OPEN_BASKET_EXISTS`; after setting the first basket's holds expired, a new basket succeeds; (e) legacy pending hold with `basket_id NULL` blocks a new basket; (f) concurrency: two psql sessions (spawn, like the existing race test) hold overlapping baskets A:{C1,C2} and B:{C2,C3} at once → exactly one succeeds, the other has zero bookings, no deadlock error.
- [ ] **Step 2: Run** integration → Expected: FAIL (`hold_court_basket` does not exist).
- [ ] **Step 3: Implement section 3** per Interfaces; rollback restores the 7-arg `hold_court_booking` with `TOO_MANY_HOLDS` and drops `hold_court_basket`.
- [ ] **Step 4: Run** integration → Expected: PASS (the existing 3-holds tests must be updated in the same step to the new rule; keep their intent).
- [ ] **Step 5: Commit** `feat(db): all-or-nothing basket hold, one open basket per customer`

### Task 3: Staff collect payment for a whole unpaid basket

**Files:**
- Modify: `supabase/migrations/multi_court_basket.pending.sql` (section 4), rollback
- Test: `tests/integration/run-pg-integration.mjs`

**Interfaces:**
- Produces: `settle_counter_basket(p_basket_id uuid, p_payment_method text, p_payment_reference text DEFAULT NULL) RETURNS jsonb` → `{basket_id, settled integer, amount numeric}`. Calls existing `settle_counter_payment(booking, payment, method, reference)` for every pending booking/pending payment of the basket in one transaction (so `HOLD_EXPIRED`, admin check and conflict checks apply per court and any failure aborts all). Raises `NOT_FOUND` if the basket has no pending booking.

- [ ] **Step 1: Failing test**: basket of 2 pending courts → admin settles with `cash` → both `confirmed`, both payments `paid|cash`, `amount` = sum; a basket whose hold expired → `HOLD_EXPIRED` and nothing changes; non-admin → `FORBIDDEN`.
- [ ] **Step 2: Run** → FAIL. **Step 3:** implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(db): settle a whole unpaid basket at the counter`

### Task 4: Reconcile a Stripe session per court; partial refunds

**Files:**
- Create: `src/lib/services/payments/reconcileCheckoutSession.ts`
- Modify: `src/lib/services/payments/refundWorker.ts`, `src/lib/services/payments/processStripePaymentReconciliation.ts`, `src/app/api/stripe/verify/route.ts`, `src/app/api/stripe/webhook/route.ts`, `src/app/api/cron/cleanup-expired-bookings/route.ts`
- Test: `tests/refund-worker.test.mjs`, new `tests/reconcile-checkout-session.test.mjs`

**Interfaces:**
- Produces:
  - `checkoutTargets(metadata: Record<string,string|undefined>, rows: { booking_id: string; payment_id: string; amount: number; currency: string; status: string }[]): { bookingId: string; paymentId: string; amount: number; currency: string }[]` — pure: basket metadata → every row of the basket; legacy metadata (`booking_id` + `payment_id`) → that one row.
  - `reconcileCheckoutSession(session: Stripe.Checkout.Session, supabase: SupabaseClient): Promise<{ confirmed: string[]; refunded: { bookingId: string; reason: string }[]; error: string | null }>` — loads rows (`payments` joined `bookings` by `bookings.basket_id = metadata.basket_id`, or the legacy pair), then calls `processStripePaymentReconciliation` per target with **that payment's** `amount`/`currency` and the session's payment intent.
  - `expireCheckoutSession(session, supabase): Promise<void>` — `cancel_expired_booking` for every pending booking of the session's basket (or the legacy booking).
- Refund calls pass the amount: `stripe.refunds.create({ payment_intent, amount: Math.round(Number(job.amount) * 100) }, { idempotencyKey })` in `refundWorker.ts`, and the same with the reconciled amount in `processStripePaymentReconciliation.ts`.
- verify / webhook (`checkout.session.completed`, `async_payment_succeeded`, `expired`) / cron use these helpers instead of `session.amount_total`; verify returns `{ success: true, lostCourts: string[] }` when some courts were refunded (empty when none).

- [ ] **Step 1: Failing unit tests**: `checkoutTargets` for basket metadata (2 rows → 2 targets with their own amounts) and legacy metadata (1 target); refund worker test asserts the Stripe mock received `amount: 25000` for a ₱250 job.
- [ ] **Step 2: Run** `npm test` → FAIL. **Step 3:** implement. **Step 4:** `npm test` → PASS; `npx tsc --noEmit` clean.
- [ ] **Step 5: Redelivery integration assertion** (Task 1's test file): reconciling every basket row twice yields `NO_OP` the second time and no extra `payments` rows.
- [ ] **Step 6: Commit** `feat(payments): reconcile and refund baskets per court`

### Task 5: Checkout creates a basket

**Files:**
- Modify: `src/app/api/stripe/checkout/route.ts`, `src/lib/services/payments/createCheckoutSession.service.ts`, `src/lib/services/bookings/validateBookingSlot.service.ts` (call per line)
- Test: `tests/multi-hour-booking.test.mjs` (validation per line), E2E in Task 8

**Interfaces:**
- Consumes: `hold_court_basket` (Task 2).
- Produces: POST `/api/stripe/checkout` body `{ booking_date: string; lines: { court_id: string; start_time: "HH:MM"; end_time: "HH:MM" }[] }` → `{ url }`. Client `createCheckoutSession({ date: Date, lines: { courtId: string; timeRange: string }[] }): Promise<string>`.
- Stripe session: one `line_items` entry per item (`"<court> — <date> • <start>–<end>"`, `unit_amount = round(amount*100)`), `metadata: { basket_id }`, then `confirm_checkout_hold` per item (unchanged RPC). Error mapping: `OPEN_BASKET_EXISTS` → 409 `"You already have a reservation awaiting payment. Complete or cancel it under 'My Bookings' first."`; `SLOT_UNAVAILABLE: …` → 409 with `"<court> <time> was just taken. Nothing was reserved — please choose again."`.

- [ ] **Step 1:** update the validation unit test to validate each line (two lines, one invalid → 400 message names the line). **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** `npm test`, `tsc` → PASS. **Step 5: Commit** `feat(checkout): one Stripe checkout per basket`

### Task 6: Unpaid basket = one unit for resume and every cancel; paid court = alone

**Files:**
- Modify: `src/app/api/bookings/cancel/route.ts`, `src/app/api/bookings/resume-payment/route.ts`, `src/app/api/admin/bookings/status/route.ts`, `src/app/api/admin/payments/settle/route.ts`, `src/components/admin/bookings/settlePaymentModal.tsx`
- Test: E2E (Task 8); unit for any new pure helper

**Interfaces:**
- Group rule everywhere: siblings = pending bookings with the same `coalesce(basket_id, id)`.
- Customer cancel of a `pending` booking cancels all pending siblings (service client, `cancelReasonFor(booking, "customer")` each), expires the shared Stripe session once, marks their pending payments failed. `confirmed` booking: unchanged (that court only, refund its payment).
- Resume: reuse the open session; if `complete` → 409 (existing); otherwise create one new session for all pending siblings (line per court) and `confirm_checkout_hold` per sibling.
- Admin `cancelled` on a pending booking: all pending siblings, `buildStatusUpdate(..., booking)` each, session expired once. Admin settle on a pending booking with `basket_id`: call `settle_counter_basket`; settle modal shows the basket total and "N courts" (sum of sibling payment amounts from the booking list data).

- [ ] **Step 1–4:** implement per route, `tsc` + `eslint` clean; repeat-cancel of a paid court returns 409 the second time and the refund ledger has one row (Review Focus 3).
- [ ] **Step 5: Commit** `feat: unpaid baskets act as one for resume and cancel`

### Task 7: Customer basket UI

**Files:**
- Create: `src/components/customers/basket-sheet.tsx`
- Modify: `src/components/customers/booking-container.tsx`, `src/components/customers/booking-modal.tsx`, `src/components/customers/types.ts`, `src/components/customers/booking-history-container.tsx`
- Test: E2E (Task 8)

**Interfaces:**
- `Slot` gains nothing; container state becomes `basket: Slot[]` (one per court). Tapping an open slot on a court not in the basket adds a line at `min_hours`; on a court in the basket uses today's extend/deselect rules for that line. Changing date clears the basket with toast `"Basket cleared for the new date."`.
- `BasketSheet({ lines: Slot[]; pricing: Pricing; onDuration(court, hours); onRemove(court); onCheckout() })` — fixed bottom sheet: heading `Your basket · N court(s)`, one row per line (court, range, duration buttons min..max, remove button `aria-label="Remove <court>"`), `Total` (sum), `includes peak rate` when any line has a peak hour, note `"All courts are held together, or none."`, button `Continue to Checkout`. Hidden when empty.
- Booking modal lists every line and the total. My Bookings: pending siblings show `"Part of a N-court booking"`; the cancel dialog for a pending basket says `"This cancels all N courts in this unpaid booking."`.

- [ ] **Step 1–3:** implement; `tsc`, `eslint` clean; manual check at 412 px that the sheet does not cover the last grid row (bottom padding).
- [ ] **Step 4: Commit** `feat(ui): multi-court basket on the booking grid`

### Task 8: End-to-end tests and suite updates

**Files:**
- Create: `tests/e2e/basket.spec.mjs`
- Modify: `tests/e2e/booking-flow.spec.mjs` (tests that leave CUSTOMER with an open hold before creating another: cancel/expire it first or use CUSTOMER2), `tests/e2e/admin-walk-in.spec.mjs` if affected

**Interfaces:** consumes everything above; local stack only (`writesAllowed`).

- [ ] **Step 1: Tests**:
  - two courts 6–8 PM → sheet total = sum, Stripe test card paid → both bookings `confirmed|paid`, one Stripe session id on both;
  - basket where one court is taken by CUSTOMER2 first → error names that court, CUSTOMER has 0 new bookings;
  - customer cancels one paid court → that payment `refunded` for its amount only, the other stays `confirmed|paid`; cancelling it again → refused;
  - second checkout while a basket is open → 409 message from Task 5;
  - staff collect cash on one court of an unpaid 2-court basket → both confirmed, total collected; staff cancel → both cancelled;
  - remove both lines from the sheet → sheet gone; change date → basket cleared (Review Focus 5).
- [ ] **Step 2: Run** the full suite against the local stack (`E2E_LOCAL_DB=1 E2E_BASE_URL=http://localhost:3200 npx playwright test`) → Expected: all pass; then `npm test`, integration, `tsc`, `eslint`, `next build`.
- [ ] **Step 3: Commit** `test(e2e): multi-court basket`

**Release order (owner approval each):** apply `multi_court_basket` to production (old app keeps working: `hold_court_booking` keeps its 7 named args with a defaulted 8th; old single sessions reconcile as before), rename the file to its recorded version, then deploy the app.
