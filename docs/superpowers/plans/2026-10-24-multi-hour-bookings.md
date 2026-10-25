# Multi-Hour Consecutive Booking Implementation Plan (Revised)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable customers to reserve multiple consecutive hourly slots (1 to 3 hours) on a single court in a single transaction with atomic database-level concurrency protection across all booking paths, strict server-side price calculation, safe Stripe failure recovery, and real-time interactive slot highlighting.

**Architecture:** 
- A single `bookings` row stores the entire continuous reservation interval (`start_time` of the first slot to `end_time` of the last slot) and the full `total_amount`.
- A dedicated PostgreSQL stored procedure (`hold_court_booking`) acquires an exclusive row lock on the court (`SELECT id FROM courts WHERE id = p_court_id FOR UPDATE`), verifies zero overlapping reservations across all active holding statuses (`['confirmed', 'checked_in', 'in_progress', 'completed', 'pending']`), and atomically inserts the pending booking and payment records.
- All overlapping booking creation paths (online checkout and both walk-in branches) are reconciled to use compatible court row-level locking.
- If Stripe session creation fails, the server immediately rolls back the pending hold synchronously. If an unhandled crash or drop occurs, the 30-minute cron cleanup expires the hold, and the customer can resume payment via `/my-bookings`.
- The server validates that the duration is 1, 2, or 3 whole hours, falls within operating hours, and calculates the price using trusted server rules (`durationHours * 200`), ignoring any client-sent amounts.
- The client UI presents duration pills (`[1 hr] [2 hrs] [3 hrs]`) in the floating action bar with instant multi-slot highlighting on the grid.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Tailwind CSS v4, Supabase PostgreSQL, Stripe Checkout, Node.js Test Runner.

---

## Global Constraints

- **Single Row Interval:** Always store multi-hour bookings as a single `bookings` record with unified `start_time` and `end_time`. Never split a multi-hour session into multiple separate rows.
- **Server Authority:** Never trust client-provided duration or total amount. Derive duration solely from validated `start_time` and `end_time`, and calculate price via `calculateCourtPrice(durationHours)`.
- **Universal Concurrency Protection:** All booking creation paths (online checkout, guest walk-in, and member walk-in) must lock the court row before verifying overlaps, ensuring zero race conditions between customer and staff.
- **Strict Whole-Hour Increments:** Durations must be whole hours (1, 2, or 3). Fractional hours (e.g. 1.5h) or non-standard start minutes (e.g. 08:15) must be rejected with 400 Bad Request.
- **Fail-Safe Stripe Recovery:** Only delete pending holds synchronously on definite pre-creation errors (invalid parameters or auth failure). On ambiguous network timeouts, preserve the pending records so payment resumption, webhooks, or the 30-minute expiration cron can safely resolve the hold without dropping paid bookings.
- **Shared Court-Locking RPC as Mandatory Concurrency:** The shared court-locking RPC (`hold_court_booking`) is the sole required concurrency protection mechanism. The PostgreSQL GiST exclusion constraint remains strictly optional pending verification of remote database extensions and historical test data cleanliness.
- **Production Data Preservation:** All existing single-hour bookings, payments, customer records, and courts are preserved untouched. Zero columns or tables are deleted or altered destructively.
- **Venue Timezone:** All booking date and operating hour comparisons must use `Asia/Manila` (UTC+8).

---

## Schema & Status Verification Matrix

### Verified from Codebase:
| Table | Column | Type | Constraints / Values | Notes |
| :--- | :--- | :--- | :--- | :--- |
| `courts` | `id` | `uuid` | Primary Key | Locked via `FOR UPDATE` |
| `courts` | `name` | `text` | e.g. "Court 1" | |
| `courts` | `status` | `text` | `'active'`, `'available'`, `'maintenance'`, `'closed'` | |
| `bookings` | `id` | `uuid` | Primary Key | |
| `bookings` | `user_id` | `uuid` | Nullable, FK to `auth.users` | Online & registered walk-in |
| `bookings` | `customer_id`| `uuid` | Nullable, FK to `customers.id` | Guest walk-in players |
| `bookings` | `customer_name`| `text` | Denormalized display name | |
| `bookings` | `court_id` | `uuid` | FK to `courts.id` | |
| `bookings` | `booking_date`| `date` | Format `YYYY-MM-DD` | |
| `bookings` | `start_time` | `time` | Format `HH:MM:SS` | Whole hours only |
| `bookings` | `end_time` | `time` | Format `HH:MM:SS` | Whole hours only |
| `bookings` | `status` | `text` | `'pending'`, `'confirmed'`, `'checked_in'`, `'in_progress'`, `'completed'`, `'no_show'`, `'cancelled'` | Active holds: `'pending'`, `'confirmed'`, `'checked_in'`, `'in_progress'`, `'completed'` |
| `bookings` | `total_amount`| `numeric`| In PHP (e.g. 200, 400, 600) | |
| `payments` | `id` | `uuid` | Primary Key | |
| `payments` | `booking_id` | `uuid` | FK to `bookings.id` | 1:1 relationship |
| `payments` | `amount` | `numeric`| Matches `bookings.total_amount`| |
| `payments` | `currency` | `text` | Always `'php'` | |
| `payments` | `status` | `text` | `'pending'`, `'paid'`, `'refunded'`, `'cancelled'`, `'failed'` | |
| `payments` | `stripe_session_id` | `text` | Stripe Checkout session ID | Nullable until session created |
| `operating_hours` | `day_of_week` | `text` | `'Sunday'` ... `'Saturday'` | |
| `operating_hours` | `is_open` | `boolean` | | |
| `operating_hours` | `open_time` | `time` | e.g. `'06:00:00'` | |
| `operating_hours` | `close_time` | `time` | e.g. `'22:00:00'` | |

### Unverified without Direct Remote DB Access:
1. Whether `btree_gist` extension is currently enabled in the Supabase PostgreSQL instance.
2. Whether historical dirty test data contains overlapping rows that would block `ALTER TABLE ... ADD CONSTRAINT EXCLUDE`.
3. The exact internal PL/pgSQL function body of `create_walk_in_booking` currently deployed on the remote database.

---

## Task 1: Unified Database Concurrency Protection (`hold_court_booking` RPC & Walk-In Reconciliation)

**Files:**
- Create: `supabase/migrations/20261024_hold_court_booking_rpc.sql`
- Modify: `src/app/api/stripe/checkout/route.ts`
- Modify: `src/lib/services/bookings/createWalkInBooking.service.ts`

**Interfaces:**
- Consumes: Supabase PostgreSQL
- Produces:
  - Database function `hold_court_booking(p_court_id uuid, p_booking_date date, p_start_time time, p_end_time time, p_user_id uuid, p_amount numeric)`
  - Reconciled walk-in booking creation ensuring registered member path also acquires court lock.

- [ ] **Step 1: Write SQL migration for `hold_court_booking` RPC**
  ```sql
  CREATE OR REPLACE FUNCTION hold_court_booking(
    p_court_id uuid,
    p_booking_date date,
    p_start_time time,
    p_end_time time,
    p_user_id uuid,
    p_amount numeric
  ) RETURNS jsonb LANGUAGE plpgsql AS $$
  DECLARE
    v_conflict_id uuid;
    v_booking_id uuid;
    v_payment_id uuid;
  BEGIN
    -- 1. Acquire exclusive row lock on the court
    PERFORM id FROM courts WHERE id = p_court_id FOR UPDATE;

    -- 2. Check for overlapping reservations across all active holding statuses
    SELECT id INTO v_conflict_id
    FROM bookings
    WHERE court_id = p_court_id
      AND booking_date = p_booking_date
      AND status IN ('confirmed', 'checked_in', 'in_progress', 'completed', 'pending')
      AND start_time < p_end_time
      AND end_time > p_start_time
    LIMIT 1;

    IF v_conflict_id IS NOT NULL THEN
      RAISE EXCEPTION 'SLOT_UNAVAILABLE' USING ERRCODE = 'P0001';
    END IF;

    -- 3. Insert pending booking
    INSERT INTO bookings (
      user_id, court_id, booking_date, start_time, end_time, status, total_amount
    ) VALUES (
      p_user_id, p_court_id, p_booking_date, p_start_time, p_end_time, 'pending', p_amount
    ) RETURNING id INTO v_booking_id;

    -- 4. Insert pending payment
    INSERT INTO payments (
      booking_id, amount, currency, status
    ) VALUES (
      v_booking_id, p_amount, 'php', 'pending'
    ) RETURNING id INTO v_payment_id;

    RETURN jsonb_build_object('booking_id', v_booking_id, 'payment_id', v_payment_id);
  END;
  $$;
  ```
- [x] **Step 1: Write SQL migration for `hold_court_booking` RPC**
- [x] **Step 2: Document optional GiST exclusion constraint with prerequisite verification query**
- [x] **Step 3: Update `checkout/route.ts` to use `hold_court_booking` with graceful fallback**
- [x] **Step 4: Reconcile registered member walk-in booking path in `createWalkInBooking.service.ts`**
- [x] **Step 5: Disposable Supabase Staging Verification Procedure**
  - Detailed verification procedure defined in `docs/superpowers/plans/2026-10-24-supabase-staging-verification-plan.md`.

---

## Task 2: Server-Side Validation, Operating Hours & Pricing Service

**Files:**
- Modify: `src/lib/services/courts/calculateCourtPrice.service.ts`
- Modify: `src/app/api/stripe/checkout/route.ts`

**Interfaces:**
- Consumes: `operating_hours` table, `calculateCourtPrice`
- Produces:
  - `calculateCourtPrice(durationHours: number): number`
  - Validated server-derived duration and price in `POST /api/stripe/checkout`

- [x] **Step 1: Update `calculateCourtPrice.service.ts`**
  - Accept `durationHours: number = 1`.
  - Enforce `const HOURLY_RATE = 200; return Math.max(1, durationHours) * HOURLY_RATE;`.
- [x] **Step 2: Implement server-side duration derivation in `checkout/route.ts`**
  - Parse `start_time` and `end_time` (e.g. `'08:00'` to `'10:00'`).
  - Reject non-zero minutes/seconds (must end in `:00`).
  - Compute `durationHours = (endMinutes - startMinutes) / 60`.
  - Validate: `Number.isInteger(durationHours)` and `1 <= durationHours <= 3`. Return HTTP 400 if invalid.
- [x] **Step 3: Validate operating hours on server**
  - Query `operating_hours` for the day of week corresponding to `booking_date` (Asia/Manila).
  - Verify venue is open and `start_time >= open_time` and `end_time <= close_time`.
  - Return HTTP 400 if the reservation extends past venue closing time.
- [x] **Step 4: Update Stripe session line item description**
  - Set `name: `${court_name} — Court Booking (${durationHours} ${durationHours === 1 ? 'Hour' : 'Hours'})``.
  - Set `description: `${booking_date} • ${format12h(start_time)} – ${format12h(end_time)}``.
  - Set `unit_amount: Math.round(amount * 100)`.

---

## Task 3: Stripe Failure Recovery & Hold Lifecycle Handling

**Files:**
- Modify: `src/app/api/stripe/checkout/route.ts`
- Verify: `src/app/api/bookings/resume-payment/route.ts`
- Verify: `src/app/api/cron/cleanup-expired-bookings/route.ts`

**Interfaces:**
- Ensures pending holds are never orphaned indefinitely when Stripe Checkout encounters errors, while strictly preventing premature deletion on ambiguous timeouts.

- [x] **Step 1: Differentiate definite failure vs ambiguous timeout in `checkout/route.ts`**
  - **Definite Pre-Creation Failure (Safe to Delete):**
    - Triggers on: missing environment secrets, invalid request parameters (`StripeInvalidRequestError`), or client authentication errors (`StripeAuthenticationError`).
    - Behavior: Stripe never created a session. Synchronously delete `createdPaymentId` and `createdBookingId` to instantly release the slot, and return HTTP 400/500 with user-friendly error.
  - **Ambiguous Network Timeout / Post-Creation Failure (DO NOT Delete):**
    - Triggers on: `StripeConnectionError`, gateway timeout, socket hang-up, or error after `sessions.create` returned.
    - Behavior: A valid session may have been created or may be processing at Stripe. **Do not delete `bookings` or `payments` rows**. Keep records in `status: 'pending'`.
    - Log detailed diagnostic context (`booking_id`, `payment_id`, error name).
    - Return HTTP 500 asking the customer to check `/my-bookings` or retry.
- [x] **Step 2: Asynchronous recovery via payment resumption**
  - If an ambiguous timeout occurred, the customer can visit `/my-bookings` or click the amber pending slot on the booking grid.
  - Calling `/api/bookings/resume-payment`:
    - Validates `booking.status === 'pending'`.
    - Checks whether match time has passed and checks for slot conflicts.
    - Generates a fresh checkout session for the full `booking.total_amount` or uses existing session.
- [x] **Step 3: Webhook idempotency and payment protection**
  - If a customer completed payment during an ambiguous timeout/drop:
    - `/api/stripe/webhook` and `/api/stripe/verify` query `bookings` by `bookingId` from session metadata.
    - Because the booking was preserved in `status: 'pending'`, the webhook successfully finds the booking and promotes `payments.status = 'paid'` and `bookings.status = 'confirmed'`.
    - No customer funds are ever taken without an active reservation.
- [x] **Step 4: Asynchronous recovery via automated expiration cron**
  - If the hold is abandoned or payment was never made:
    - `/api/cron/cleanup-expired-bookings` runs every 10–30 minutes.
    - Inspects `bookings.status === 'pending'` where `created_at < now() - 30 minutes`.
    - Checks that no associated payment is marked `'paid'`.
    - Calls `stripe.checkout.sessions.expire(session_id)` to invalidate Stripe checkout.
    - Marks `payments.status = 'cancelled'` and `bookings.status = 'cancelled'`, releasing the multi-hour court slot.

---

## Task 4: Client Consecutive Availability & Duration Helper

**Files:**
- Create: `src/lib/services/bookings/multiHourAvailability.service.ts`
- Modify: `src/components/customers/types.ts`

**Interfaces:**
- Consumes: `OperatingHour[]`, `BookingSlot[]`, `Court[]`
- Produces:
  - `getAvailableDurations(courtName: string, startSlot: string, date: Date, courts: Court[], bookings: BookingSlot[], operatingHours: OperatingHour[], currentUserId?: string | null): number[]`
  - Updated `Slot` interface: `{ date: Date; court: string; startTime: string; endTime: string; duration: number; price: number; }`

- [ ] **Step 1: Update `Slot` type in `src/components/customers/types.ts`**
  - Include `startTime`, `endTime`, `duration` (1 | 2 | 3), and `price`.
- [ ] **Step 2: Implement `multiHourAvailability.service.ts`**
  - Given a start slot (e.g. `"08:00 AM - 09:00 AM"`), check if consecutive hour 2 (`"09:00 AM - 10:00 AM"`) and hour 3 (`"10:00 AM - 11:00 AM"`) are:
    1. Within venue operating hours for that date.
    2. In `available` status via `checkSlotAvailability`.
  - Return array of valid durations, e.g. `[1]`, `[1, 2]`, or `[1, 2, 3]`.
- [ ] **Step 3: Write unit tests in `tests/multi-hour-booking.test.mjs`**
  - Test case: Start slot at 8 AM with 9 AM free and 10 AM booked returns `[1, 2]`.
  - Test case: Start slot at 9 PM when venue closes at 10 PM returns `[1]`.
  - Test case: Start slot with 9 AM free and 10 AM free returns `[1, 2, 3]`.

---

## Task 5: Interactive Customer UI — Duration Pills & Range Highlighting

**Files:**
- Modify: `src/components/customers/court-availability-grid.tsx`
- Modify: `src/components/customers/booking-container.tsx`

**Interfaces:**
- Consumes: `multiHourAvailability.service`, `Slot`
- Produces:
  - Reactive grid highlighting all slots in selected range.
  - Floating action bar containing `[1 hr] [2 hrs] [3 hrs]` duration selector pills.

- [ ] **Step 1: Update `CourtAvailabilityGrid` slot matching**
  - Change `isSelected` check from exact time string equality to interval overlap:
    `slotStart >= selectedSlot.startTime && slotEnd <= selectedSlot.endTime && court === selectedSlot.court`.
  - Add visual styling for multi-slot connected selection (rounded top on start, rounded bottom on end, joined border).
- [ ] **Step 2: Add duration state & pills to `BookingContainer` bottom action bar**
  - When slot is clicked, calculate `availableDurations` using `getAvailableDurations`.
  - Default selected duration to `1`.
  - Render pills `[ 1 hr ]`, `[ 2 hrs ]`, `[ 3 hrs ]`:
    - If duration > available max, mark pill disabled/unselectable.
    - Clicking a valid pill updates `selectedSlot` with new `endTime`, `duration`, and `price = duration * 200`.
- [ ] **Step 3: Update bottom summary text**
  - Display: `"${selectedSlot.court} • ${selectedSlot.startTime} – ${selectedSlot.endTime} (${selectedSlot.duration} hrs) • ₱${selectedSlot.price}"`.

---

## Task 6: Customer Booking Modal & Checkout Dispatch

**Files:**
- Modify: `src/components/customers/booking-modal.tsx`
- Modify: `src/lib/services/payments/createCheckoutSession.service.ts`

**Interfaces:**
- Consumes: `Slot`
- Produces:
  - Detailed modal summary with duration badge and itemized pricing breakdown.
  - API call passing `court_id`, `booking_date`, `start_time`, `end_time`.

- [ ] **Step 1: Update `BookingModal` summary presentation**
  - Render duration badge: `<Badge variant="secondary">{selectedSlot.duration} Hours</Badge>`.
  - Render formatted time range: `${selectedSlot.startTime} – ${selectedSlot.endTime}`.
  - Render pricing breakdown: `${selectedSlot.duration} hrs × ₱200/hr = ₱${selectedSlot.price.toLocaleString()}`.
- [ ] **Step 2: Update `createCheckoutSession.service.ts`**
  - Accept `startTime: string` and `endTime: string` (or derive from `selectedSlot`).
  - Convert to 24h format (`to24h`).
  - Send `{ court_id, court_name, booking_date, start_time, end_time }` to `POST /api/stripe/checkout`.

---

## Task 7: Admin Add Booking Modal Duration Fee Calculation

**Files:**
- Modify: `src/components/admin/bookings/addBookingModal.tsx`

**Interfaces:**
- Automatically computes default fee when admin inputs `startTime` and `endTime`.

- [ ] **Step 1: Calculate duration in `addBookingModal.tsx`**
  - When `startTime` and `endTime` are both filled, calculate `hours = (end - start)`.
  - If `hours > 0`, set default `amount` to `String(hours * 200)`.
  - Preserve admin's ability to manually change the fee.

---

## Task 8: Comprehensive Test Suite & Edge-Case Validation

**Files:**
- Modify: `tests/booking-rules.test.mjs`
- Create: `tests/multi-hour-booking.test.mjs`

**Test Cases to Implement:**
- [ ] **Step 1: Normal bookings test:** Verify 1-hour, 2-hour, and 3-hour durations compute correct start/end times and prices (₱200, ₱400, ₱600).
- [ ] **Step 2: Unavailable consecutive slot test:** Verify that when slot $t_1$ is booked, a reservation starting at $t_0$ only permits duration 1.
- [ ] **Step 3: Operating hours boundary test:** Verify that a slot 1 hour before venue close only permits duration 1.
- [ ] **Step 4: Server validation test:** Verify server rejects duration < 1, duration > 3, non-integer hours (e.g. 1.5h), and inverted time ranges (`end_time <= start_time`).
- [ ] **Step 5: Overlapping concurrent requests test (Customer vs Customer):** Verify that two requests competing for overlapping intervals (Req A: 8–10 AM, Req B: 9–11 AM) on the same court detect collision and reject the second request.
- [ ] **Step 6: Overlapping concurrent requests test (Customer vs Admin):** Verify that a customer request (8–10 AM) colliding with an admin walk-in reservation (9–10 AM) detects collision.
- [ ] **Step 7: Stripe session failure test:** Verify that simulated failure during Stripe session creation rolls back the pending booking and payment records cleanly.
- [ ] **Step 8: Expired pending booking test:** Verify that cleanup cron accurately cancels multi-hour pending bookings without affecting confirmed/paid bookings.
- [ ] **Step 9: Backward compatibility test:** Verify that existing single-hour bookings continue to parse, format, and evaluate availability identically.
- [ ] **Step 10: Run test runner:** Run `npm test` and `npx tsc --noEmit` and ensure all suites pass with 0 errors.
