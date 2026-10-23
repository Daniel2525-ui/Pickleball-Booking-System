# Admin Walk-In Bookings and Game-Day Tracking Design

## 1. Executive Summary & Goals

This feature enables venue staff at Crosshair Dinkers (Butuan City) to:
1. **Record on-the-spot walk-in reservations** without requiring or creating Supabase Authentication accounts.
2. **Search and reuse existing customer records**, with proactive duplicate warnings so staff can match repeat players.
3. **Accept counter payments** (Cash, GCash) or create **Unpaid / Pay Later** reservations that hold court slots until settled.
4. **Track game-day court operations** through an explicit operational state machine (`Confirmed` -> `Checked In` -> `In Progress` -> `Completed`, or `Confirmed` -> `No-Show` after a 15-minute grace period).
5. **Preserve existing online booking, Stripe checkout, webhooks, and customer data** with zero regressions.

---

## 2. Implementation Stages

The feature is split into two sequential stages:

```
┌────────────────────────────────────────────────────────────────────────┐
│ STAGE 1: Walk-In Bookings & Counter Payment Handling                   │
│ - Dedicated `customers` table for non-auth players                     │
│ - Search & duplicate detection modal in `AddBookingModal`              │
│ - Counter payment recording (Cash, GCash, Unpaid / Pay Later)          │
│ - In-place payment settlement for unpaid reservations                  │
│ - Strict overlapping slot conflict prevention with court locking       │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│ STAGE 2: Game-Day Operations & Status Lifecycle                        │
│ - Operational state machine: Checked In, In Progress, Completed        │
│ - 15-minute grace period enforcement for No-Shows with warning modal   │
│ - Immediate court slot release upon No-Show confirmation               │
│ - Real-time operational action controls on Today's Schedule & Dash     │
│ - Game-day audit timestamps (`checked_in_at`, `started_at`, etc.)      │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Database Schema

### 3.1. `public.customers`
Holds non-auth walk-in players:
- `id` (UUID, Primary Key)
- `full_name` (TEXT, NOT NULL)
- `phone` (TEXT, nullable)
- `email` (TEXT, nullable)
- `created_at` (TIMESTAMPTZ, default UTC now)
- `updated_at` (TIMESTAMPTZ, default UTC now)

### 3.2. `public.bookings` Updates
- `user_id` (UUID, nullable, references `profiles.id`)
- `customer_id` (UUID, nullable, references `customers.id`)
- `customer_name` (TEXT, NOT NULL, cached for fast indexing and display)
- `checked_in_at`, `started_at`, `completed_at`, `no_show_at` (TIMESTAMPTZ, nullable)
- Check constraint: exactly one of `user_id` or `customer_id` is set.
- Statuses: `'pending'`, `'confirmed'`, `'checked_in'`, `'in_progress'`, `'completed'`, `'no_show'`, `'cancelled'`.

### 3.3. `public.payments` Updates
- `payment_method` (TEXT, e.g. `'stripe'`, `'cash'`, `'gcash'`, or null for unpaid)
- `payment_reference` (TEXT, e.g. GCash reference code)
- Statuses: `'pending'`, `'paid'`, `'refunded'`, `'failed'`.

---

## 4. Concurrency & Business Logic

### 4.1. Concurrency Safeguard
1. Row-level locking on court record (`SELECT id FROM courts WHERE id = p_court_id FOR UPDATE`) inside the booking creation RPC `create_walk_in_booking`.
2. Atomic overlap conflict detection query against active holding statuses: `['confirmed', 'checked_in', 'in_progress', 'completed', 'pending']`.

### 4.2. Payment Integrity
- Unpaid walk-in reservations create a single row in `payments` with `status: 'pending'`.
- Settling at the counter executes an atomic update:
  `UPDATE payments SET status = 'paid', payment_method = $1, payment_reference = $2, paid_at = now() WHERE id = $3 AND status = 'pending'`
- If two requests collide, only the first updates; the second matches 0 rows and returns an error without creating duplicate payment rows.

### 4.3. Time & Availability Rules
- Asia/Manila (UTC+8) venue timezone.
- No-show 15-minute grace period calculated from scheduled match start time.
- Marking `no_show` releases court immediately.
- Marking `completed` preserves court reservation until scheduled `end_time` to prevent unauthorized rebooking of remaining reserved time.
