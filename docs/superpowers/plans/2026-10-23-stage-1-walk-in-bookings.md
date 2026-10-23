# Stage 1: Admin Walk-In Bookings & Counter Payments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable venue admins to search/create non-auth walk-in customers, record walk-in reservations, accept Cash/GCash counter payments or create Unpaid reservations, and settle unpaid bookings in place.

**Architecture:** A dedicated `customers` table stores non-auth player records. The `create_walk_in_booking` database RPC locks the court row, verifies zero overlapping active bookings, inserts a confirmed booking linking either to `user_id` or `customer_id`, and creates the initial payment row. Settle counter payment executes an atomic row-level update on `payments` preventing duplicate settlements.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Tailwind CSS v4, Supabase PostgreSQL, Lucide React.

**Spec:** [2026-10-23-admin-walk-in-and-game-day-tracking-design.md](file:///c:/Users/Erle%20Daniel%20Sudario/OneDrive/Desktop/WebApp%20Projects/Pickleball%20Booking%20System/pb-booking-system/docs/superpowers/specs/2026-10-23-admin-walk-in-and-game-day-tracking-design.md)

## Global Constraints

- Never create Supabase auth accounts for walk-in players.
- Keep booking status separate from payment status. Unpaid walk-in reservations have `bookings.status = 'confirmed'` and `payments.status = 'pending'`.
- Preserve existing online booking, Stripe checkout, webhook, and authorization behavior.
- Settle counter payments in-place on existing payment rows; never insert duplicate payment rows.
- Asia/Manila (UTC+8) venue timezone for all booking date/time operations.

## Review Focus

- Duplicate customer detection correctly surfaces matching names and phone numbers.
- Unpaid walk-in reservations are not prematurely cancelled by online Stripe cleanup crons.
- Settling a payment twice concurrently fails the second attempt cleanly with 409 Conflict.
- Booking search by customer name correctly finds both online registered players and walk-in players.
- Slot conflict detection rejects overlapping walk-in reservations on the same court.

---

### Task 1: Customer Search & Creation Services

**Files:**
- Create: `src/lib/services/customers/searchCustomers.service.ts`
- Create: `src/lib/services/customers/createWalkInCustomer.service.ts`
- Modify: `src/lib/services/customers/customersTypes.ts`

**Interfaces:**
- Consumes: Supabase client
- Produces:
  - `searchCustomers(query: string): Promise<{ data: UnifiedCustomerResult[], error: Error | null }>`
  - `createWalkInCustomer(input: { fullName: string; phone?: string; email?: string }): Promise<{ data: Customer | null; error: Error | null }>`

- [ ] **Step 1: Write unit test / verification script for customer search and creation**
- [ ] **Step 2: Update `customersTypes.ts` with `UnifiedCustomerResult` and walk-in types**
- [ ] **Step 3: Implement `createWalkInCustomer.service.ts`**
- [ ] **Step 4: Implement `searchCustomers.service.ts` to query `customers` and `profiles`**
- [ ] **Step 5: Run verification script and ensure PASS**
- [ ] **Step 6: Commit changes**

---

### Task 2: Walk-In Booking Creation & Payment Settlement Services

**Files:**
- Create: `src/lib/services/bookings/createWalkInBooking.service.ts`
- Create: `src/lib/services/payments/settleCounterPayment.service.ts`
- Modify: `src/lib/services/bookings/filterBookingsData.service.ts`

**Interfaces:**
- Consumes: `create_walk_in_booking` Supabase RPC, Supabase client
- Produces:
  - `createWalkInBooking(params: WalkInBookingParams): Promise<{ bookingId: string | null; error: Error | null }>`
  - `settleCounterPayment(paymentId: string, bookingId: string, method: 'cash' | 'gcash', reference?: string): Promise<{ success: boolean; error: Error | null }>`

- [ ] **Step 1: Write verification script testing `createWalkInBooking` and `settleCounterPayment`**
- [ ] **Step 2: Implement `createWalkInBooking.service.ts` calling the database RPC**
- [ ] **Step 3: Implement `settleCounterPayment.service.ts` with atomic pending guard**
- [ ] **Step 4: Update `filterBookingsData.service.ts` to search across `customer_name`**
- [ ] **Step 5: Run verification script and ensure PASS**
- [ ] **Step 6: Commit changes**

---

### Task 3: Modal UI for Walk-In Registration & Payment Method Selection

**Files:**
- Modify: `src/components/admin/bookings/addBookingModal.tsx`

**Interfaces:**
- Consumes: `searchCustomers`, `createWalkInCustomer`, `createWalkInBooking`
- Produces: Complete reservation dialog with customer search, duplicate warning, and payment options

- [ ] **Step 1: Add debounced customer search input with results dropdown**
- [ ] **Step 2: Implement duplicate detection banner when entered name matches existing customer**
- [ ] **Step 3: Add Payment Method selector (`Cash (Paid)`, `GCash (Paid)`, `Pay Later (Unpaid)` with optional GCash reference input)**
- [ ] **Step 4: Connect form submission to `createWalkInBooking`**
- [ ] **Step 5: Test modal manually in browser and verify reservation creation**
- [ ] **Step 6: Commit changes**

---

### Task 4: Admin Bookings Table Enhancements & Settlement Modal

**Files:**
- Create: `src/components/admin/bookings/settlePaymentModal.tsx`
- Modify: `src/components/admin/bookings/bookings-table.tsx`

**Interfaces:**
- Consumes: `settleCounterPayment`, Supabase client
- Produces: Settle payment dialog, payment method badges, and row action triggers

- [ ] **Step 1: Create `settlePaymentModal.tsx` with Cash/GCash confirmation and reference input**
- [ ] **Step 2: Update `bookings-table.tsx` to display `customer_name` and dual payment badges**
- [ ] **Step 3: Add `[Collect Payment]` trigger in row actions for unpaid bookings**
- [ ] **Step 4: Verify payment settlement updates table in real-time**
- [ ] **Step 5: Commit changes**

---

### Task 5: End-to-End Verification & Online Regression Check

**Files:**
- Test scripts / browser subagent

- [ ] **Step 1: Verify walk-in booking creation with Cash, GCash, and Pay Later**
- [ ] **Step 2: Verify duplicate customer warning and profile reuse**
- [ ] **Step 3: Verify atomic payment settlement**
- [ ] **Step 4: Verify conflict prevention rejects overlapping bookings on same court**
- [ ] **Step 5: Run online Stripe checkout regression test to ensure zero breakage**
