# Admin Reports page — design

**Approved mockup:** `docs/superpowers/specs/2026-11-05-admin-reports-mockup.html` (user: "it's perfect", 2026-11-05).

## Why
The owner runs the venue from another city. Today the only revenue figures are *Revenue Today* (dashboard) and one-day totals
on Payments; nobody can see a week, month or all-time total. Reports answers, for any period: how much did we make, are
people coming and keeping their bookings, when is it busy, who are the best customers.

## Who
Admins (stored as `is_owner`) only, gated exactly like Pricing and Settings (proxy + sidebar `ownerOnly`). Front desk never
sees the page or link.

## What's on the page (top to bottom, as the mockup)
1. Header "Reports"; period picker: **This week, This month, Last month, Custom, All time** (default This month);
   **Download CSV**.
2. Four tiles: **Net revenue** (with % vs previous period), **Bookings** (with % vs previous, and court-hours),
   **Courts full** (% of open court-hours booked), **Cancellations & no-shows** (with change vs previous, as a count).
3. **Revenue per day** bar chart (net), hover shows the day and amount; subtitle names the best day.
4. **Where the money came from:** Cash, GCash, Card, Refunded; then Court bookings vs Open play.
5. **When the courts are busy:** weekday × hour grid, one hue light→bright, hover shows "% booked".
6. **Each court:** % full per court.
7. **Cancellations & no-shows:** cancelled count, no-show count, money kept.
8. **Best customers:** top 5 by money spent: player, visits, hours, spent, last visit.

## Definitions (decided)
- **Venue day** = Asia/Manila calendar date. Money is dated by `payments.paid_at` (as the Payments page does).
- **Net revenue** = sum of `payments.amount` with `status = 'paid'` paid in the period. A refunded payment's status is
  already `refunded`, so it is *not* in this sum; refunds are shown separately and never subtracted again. For any single
  day, Reports' net equals the Payments page's *Collected* for that day.
- **Refunded** = payments with `status = 'refunded'` whose `paid_at` falls in the period.
- **Court bookings vs open play** = payment's booking has `open_play_session_id` null vs not null.
- **Bookings** = court bookings (`court_id` not null, `open_play_session_id` null) dated in the period with status in
  `confirmed, checked_in, in_progress, completed, no_show`. **Court-hours** = their summed duration.
- **Courts full** = booked court-hours ÷ open court-hours, over days from the period start up to today (future days in the
  period are left out so "This month" isn't diluted). Booked = every non-cancelled, non-pending booking with a court,
  including open-play court blocks. Open court-hours per day = (close − open) × number of courts, 0 on closed weekdays and
  on `venue_closures` dates.
- **Cancellations** = court bookings in the period with `status = 'cancelled'` and `cancel_reason` in
  `customer, admin, payment_kept` (expired holds and other system cancellations are not cancellations). **No-shows** =
  `status = 'no_show'`. **Money kept** = paid payments on those no-shows and `payment_kept` cancellations.
- **Previous period** = the same number of days immediately before. **All time** has no comparison. When the previous
  value is 0, show no percentage.
- **Best customers** = grouped by player account, else walk-in customer record, else name; spent = their paid payments
  in the period; visits/hours = their counted bookings; last visit = latest booking date up to today.
- **Chart buckets:** days for periods up to 62 days, months beyond (All time).
- **CSV:** one row per chart bucket: date (or month), bookings, court-hours, cash, gcash, card, refunded, net.

## Non-goals
Forecasts, targets, staff performance, new tables or tracking. Nothing the existing bookings/payments data can't answer.

## Constraints
Read-only; no new tables. Times in Asia/Manila. Same look as the other admin pages (shared table, skeletons, cards).
