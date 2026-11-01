# Open play — design

## Intent

The venue wants to start **open play**: set times when players book a *spot* instead of a whole court, pay per person, show up, and rotate through the courts with whoever else came. It isn't running yet, so the system defines how it works. The aim is to sell court time to solo players and small groups, especially in hours that whole-court bookings don't fill.

Success: staff set a weekly open play schedule once, and players can find a session, book and pay for 1–4 spots by card or GCash, cancel with a refund under the usual rule, and see it all in My Bookings. Staff see who's coming, and can cancel a thin session with everyone refunded.

## Goals

### Staff (admin)
- New admin page **Open Play** in the sidebar, with three parts (approved mockup: `.superpowers/brainstorm/668-1793554583/content/open-play-admin.html`):
  1. **Weekly schedule.** Recurring sessions, each with a weekday, start and end time, one or more courts, a spot count (capacity), and a price per spot. Staff can add, edit and remove them.
  2. **Upcoming sessions.** The dated sessions made from the schedule, each with booked/capacity and status (Open, Full, Cancelled), and actions "Players" and "Cancel this date".
  3. **Player list** for a session: booker name, phone (from profile, may be blank), spot count shown as "Name +2", payment method, payment/refund status, and the total collected. It also has a **Cancel session & refund everyone** button and an **Add player** button for walk-ups (below).
- **Walk-up players (owner decision, added after review).** Staff can add players at the door from the session's player list. The walk-up flow:
  - Staff enter a name (and phone, optional; no customer account needed), pick 1–4 spots, and record payment as **cash** or **GCash at the counter** with a reference. This mirrors how walk-in court bookings work today.
  - Capacity is taken atomically, the same as online bookings.
  - A walk-up is never refunded online. If its session is cancelled, it goes to **Refund Owed** like any cash or GCash payment.
  - This one button was added to the approved admin mockup.
- **The system creates dated sessions automatically** from the weekly schedule, on a rolling **4 weeks ahead** (builder's call, see below).
- **Schedule edits** (time, courts, capacity, price) apply only to future sessions that have **no bookings** yet. Sessions with bookings keep what was sold.
- **Removing a weekly schedule** stops new sessions from being created. Sessions already created stay until staff cancel them.
- **Court conflicts.** If a court in the schedule already has an active court booking that overlaps the session on a given date, that date's session is **not created** and is shown to staff as flagged ("Not created: Court 2 already booked 7–8 PM"). A customer's court booking is never cancelled or moved by open play.
  - Flagged dates are **re-checked on every generator run**. If the conflict clears, the session is created then, even if that's later than usual.
  - Dates when the venue is closed under operating hours, or a scheduled court is in maintenance or closed, are skipped and flagged the same way.
- **Cancelling a session or a single date** cancels every spot booking in it, with a **full refund at any time**. The 2-hour cutoff only limits customers, so staff can cancel inside the window or after the start. If any GCash payment in the session is still **awaiting verification**, staff must approve or reject it first, so nobody refunds money that never arrived. The cancel button explains this and stays blocked until it's done.
  - Card payments are **refunded automatically** through the existing Stripe refund ledger and worker.
  - GCash and cash payments land in the existing **Refund Owed** list for staff to hand back and record, as today.
  - Cancelling is a staff decision. There is no automatic minimum-player rule.
- The session's courts are **blocked from regular court bookings** for its whole time span while the session exists and is not cancelled.

### Players (customer)
- New customer page **Open Play** in the main navigation (approved mockup option A in `.superpowers/brainstorm/668-1793554583/content/open-play-customer.html`). It lists upcoming sessions as cards with date, time, courts, "All levels welcome", price per player, spots left with a fill bar, and a **Book a spot** button. Full sessions show "Full" with the button disabled.
- **Court booking grid:** during a session, its courts' cells read **"Open play"** and can't be selected, so court bookers see why they aren't free.
- **Booking:**
  - Choose 1–4 spots (capped by spots left, and by **4 spots per player per session across all their active bookings**), then pay by **card (Stripe)** or **GCash**, the same two methods and flows as court bookings. Price = spots × price per spot.
  - One booking covers the group, and the booker pays for everyone. Friends' names are not collected.
  - Spots are **held** while the player pays, with the same hold, expiry and cleanup behaviour as court holds. An expired hold releases its spots.
  - A GCash spot booking follows the existing GCash flow (proof upload, Awaiting verification, staff approve or reject).
- **My Bookings** shows open play bookings alongside court bookings: date, time, "Open play · N spots", status, and the refund message.
- **Cancellation:** the same rule as court bookings. Full refund if cancelled **2+ hours before start**; online cancel is blocked within 2 hours. The whole group booking cancels together (no partial cancel). Card refunds go out automatically, GCash and cash go to Refund Owed. Freed spots go back on sale.
- **Venue cancellation:** the booking shows as cancelled by the venue in My Bookings, with its refund status. No email or SMS; the app sends none today.

## Non-goals
- **Skill levels.** Every session is open to everyone.
- **Court rotation, queues or match-making** on the day. Players and staff sort that out on court.
- **Check-in at the door.** Staff use the player list; a check-in button may come later.
- **Collecting each friend's name.**
- **Partial cancellation** of a group booking.
- **Waitlists** for full sessions.
- **One-off (non-recurring) sessions.** Everything comes from the weekly schedule; staff skip a date by cancelling it.
- **Peak or time-based pricing** for open play. Each weekly schedule has one flat price per spot.
- **Email or SMS notifications.**

## Anti-goals (a failure even if it works)
- **More spots sold than capacity,** for example two players buying the last spot at the same moment. Capacity must be enforced atomically in the database, like court slot holds are today.
- **A customer's existing court booking cancelled, moved or double-booked** because an open play session was created on its court.
- **A court sold as a regular booking during an active open play session** on that court.
- **A player paying for a session that's cancelled or full** (for example a stale page), or a cancelled session still taking bookings.
- **Refunds behaving differently from court bookings:** a card refund that needs a staff click when the customer cancelled within the rule, or GCash and cash refunds missing from Refund Owed.
- **Changes to the existing court booking, payment or refund behaviour** beyond showing "Open play" cells in the grid and listing spot bookings in shared places (My Bookings, Payments, Refund Owed, and the dashboard as described below).

## Dashboard
- **Revenue figures** include open play money, labelled as open play where a breakdown exists.
- **Court status** shows a court as **"Open play"** while one of its sessions is running.
- Spot bookings must not show up as **court bookings without a court**, such as a blank court in today's schedule or recent bookings.

## Constraints
- **Stack:** Next.js 16 (read `node_modules/next/dist/docs/` before writing Next code, per AGENTS.md), Supabase (Postgres, RLS, SQL functions), Stripe Checkout (card only), the existing GCash manual flow. Prices in PHP, venue time zone Asia/Manila.
- **Reuse the money machinery.** Payments, the refund ledger (`reserve_payment_refund`, the refund worker and cron, `request_manual_cash_refund` / `confirm_manual_cash_refund`), Stripe checkout and reconciliation, GCash proof and verify, the 2-hour cancellation rule, and the Refund Owed and Payments admin views must all work for spot bookings. Don't build a parallel payment or refund system. Today `payments.booking_id` references `bookings`, and these flows assume a payment belongs to a booking.
- **All money and capacity rules are enforced on the server** (route handlers and SQL functions), never only in the browser.
- **Testing:** write e2e runs on the local stack on :3200 against local Supabase only. `.env.local` points at production. Migrations go to production only after the owner says so.
- **No new dependencies** unless something truly can't be done with what's installed.

## Decided by the owner
- Players book a spot online, pay, then show up and play.
- Staff create sessions as a **weekly schedule**; the system makes the dated sessions.
- Each session has courts, a time span, a spot capacity and a price per player; its courts are blocked from court bookings.
- **Card and GCash** payment, the same as court bookings.
- **Cancellation:** full refund 2+ hours before start, the same as court bookings.
- **Staff can cancel a thin session,** refunding everyone. Players learn about it in **My Bookings**.
- **No skill levels.**
- **A separate Open Play page for players,** plus "Open play" cells in the court grid.
- **The admin page as mocked up**, with no changes.
- **One booking for up to 4 spots,** paid by the booker.
- **Staff can add walk-up players at the door,** paid in cash or GCash at the counter.

## Calls made in brainstorming (owner can overturn)
- Sessions are created **4 weeks ahead**, rolling.
- **Conflicting dates are skipped and flagged,** not forced.
- **Schedule edits only touch unbooked future sessions.**
- **The 4-spot cap** per booking.
- **No minimum-players automation.**
- **The 4-spot cap is per player per session,** not per checkout, so one person can't buy out a session with several bookings.
- **Staff cancellation always refunds in full,** whatever the time. GCash payments awaiting verification must be decided first.
- **Flagged dates are re-checked every run;** closed days and courts in maintenance are flagged the same way.
- **Dashboard:** open play counts in revenue, and courts show "Open play" during sessions.

## Left to the builder
- **Data model.** Whether a spot booking is a row in `bookings` (for example with a session link, a spot count and no single court), or a new table with the payment and refund flows taught to handle it. The constraint above applies: the existing payment and refund flows must cover it, and capacity must be atomic. Pick whichever keeps the changes to working court code smallest and safest.
- **How courts are blocked:** stored court-booking-like rows, or a check of sessions inside the court hold and walk-in functions and the availability query.
- **How and when sessions are generated:** the existing 15-minute cron, on schedule save, or both. Also how the 4-week window rolls forward.
- **Exact UI layout and copy** within the approved mockups, matching the existing admin and customer styles.
- **How Open Play spot bookings appear in the admin Bookings and Payments tables** (filters, labels), as long as they're clearly marked as open play.
