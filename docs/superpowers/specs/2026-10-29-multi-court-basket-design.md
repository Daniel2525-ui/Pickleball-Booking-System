# Multi-Court Basket: Several Courts, One Checkout

## 1. Intent

Groups at Crosshair Dinkers often want more than one court on the same evening, for example Courts 1 and 2
from 6 to 8 PM for a group of eight. Today a customer must run a separate checkout per court, and a second
player can take Court 2 while the first is still paying for Court 1. This feature lets a signed-in customer pick
slots on several courts for one date and pay for all of them in a single Stripe checkout, with the courts held
together.

Success: a group books the courts it needs in one go, never pays for a partial set it did not want, and can later
give back one court without losing the others.

## 2. Decisions made (by the venue owner)

- **Basket UI (mockup option A).** On the customer booking grid, tapping an open slot on any court adds that
  court to a basket shown in a bottom sheet. Each basket line shows the court, its time range, its own
  duration buttons (admin minimum to maximum, from `booking_settings`) and a remove (x). One total, one
  "Continue to Checkout" button. Tapping the next hour on a court in the basket extends that line (same rule
  as today's single selection).
- **One date per basket.** All lines are on the selected date.
- **All or nothing.** At checkout the database holds every line in one transaction or none. If any line is
  no longer available, nothing is held and the customer is told which court/time failed.
- **One Stripe checkout** for the basket total. Price is the sum of each line's `quote_court_price`, so peak
  rates apply per hour exactly as today.
- **Each line becomes its own booking** (one `bookings` row per court) for My Bookings, the admin list,
  check-in, no-show, completion and admin cancellation.
- **Cancel per court.** A customer can cancel any single court of a paid basket under the existing rule
  (up to `CANCELLATION_CUTOFF_HOURS` = 2 hours before that court's start). They get an automatic refund of that
  court's share only, back to the card.
- **One open basket per customer.** A customer may have only one unpaid, unexpired basket at a time; starting
  another checkout is refused (replacing the old `TOO_MANY_HOLDS` limit of 3 open holds) until they pay or
  cancel the open one, or it expires. Because a single-court booking is a basket of one, this also means one open
  single-court checkout at a time. Paid bookings are not limited.
- **Staff actions on an unpaid basket apply to the whole basket.** If staff cancel a pending court that belongs to
  an unpaid basket, every court in that basket is cancelled and its Stripe session is closed (`cancel_reason`
  `admin`, or `expired` if the hold had already timed out, as today). If staff collect payment at the counter
  for an unpaid basket, the full basket total is collected and every court is confirmed, after closing the Stripe
  session; the existing refusal for expired holds (`HOLD_EXPIRED`) and for already-paid sessions still applies.
  Once a basket is paid, staff act on each court separately (check-in, no-show, completion, cancellation, refund).

## 3. Builder's calls (made during design; change only with good reason)

- Changing the date in the grid empties the basket (with a toast). A basket may hold every court.
- One basket line per court (a court cannot appear twice in one basket).
- An unpaid basket is resumed or cancelled as a whole: "Continue Payment" reopens the one Stripe session for
  all its courts; cancelling an unpaid hold from My Bookings or the grid releases every court of that basket.
- Hold timer, 20-minute grace period (`hold_release_after`), cron cleanup, the `checkout.session.expired`
  webhook, late-payment reconciliation and refunds all act on the whole basket while it is unpaid.
- A single-court booking is simply a basket of one. The existing single-slot flow should become that, not a
  parallel path, so there is one hold, checkout, verify, webhook and cron path.
- Walk-ins (admin `create_walk_in_booking`) stay one court at a time. Out of scope.

## 4. Non-goals and anti-goals

- Non-goals: several dates in one basket; editing a paid basket (adding courts after paying); group invites or
  splitting the bill between players; admin-side baskets.
- Anti-goals (a failure even if it "works"):
  - A customer is charged for courts they did not end up holding, or holds a partial set without knowing.
  - Cancelling one court refunds more than that court's share, or refunds the whole payment.
  - A basket can block more courts for longer than a single booking can (hold duration, grace and cleanup must
    be the same as today).
  - Existing single-court bookings, refunds, late-webhook handling, or the admin lists regress.

## 5. Constraints from the current system (verified in the live schema)

- **Payments are per booking, and Stripe ids are unique per payment row.** `payments.booking_id` links one
  payment to one booking; `payments_stripe_session_id_key` (UNIQUE) and `idx_payments_stripe_payment_id`
  (UNIQUE where not null) mean one Stripe session / payment intent can belong to only one payment row today.
  `uq_payments_one_pending_per_booking` allows one pending payment per booking. The builder must choose how a
  basket's single Stripe session and payment intent map onto several bookings (for example a new basket/group
  record that owns the Stripe ids, with one payment row per booking holding that court's amount; or relaxing the
  uniques with a group key). Whatever the choice, duplicate-charge detection in `reconcile_booking_payment`
  (Branch 1.3 keys on `stripe_payment_id`) must keep working.
- **Refunds are full-payment only.** `reserve_payment_refund` enforces `FULL_REFUND_ONLY` against the payment
  row's amount, and both `refundWorker.ts` and `processStripePaymentReconciliation.ts` call
  `stripe.refunds.create({ payment_intent })` without an `amount`, which refunds the entire charge. Per-court
  refunds need an explicit amount (that court's share) and the existing reserved-sum guard must prevent the total
  of a basket's refunds from exceeding what was captured.
- **Late payments and conflicts act per booking today.** `reconcile_booking_payment` branches (court unavailable,
  start passed, already cancelled, slot conflict, duplicate) each cancel/refund one booking. For a basket paid
  late, apply them per court: courts still holdable are confirmed, any court that can no longer be honoured is
  cancelled (`cancel_reason` set as today) and refunded for its share only. The customer must be told which.
- **Stripe metadata** currently carries `booking_id` and `payment_id`; verify, webhook and cron read them. They
  must handle a basket (and keep handling sessions created before this change, which are single-court).
- **Overlap safety** is enforced by `no_overlapping_active_court_bookings` (exclusion constraint) plus court row
  locks in `hold_court_booking`. A basket hold must lock courts in a consistent order (e.g. by court id) to avoid
  deadlocks between two baskets that share courts.
- **Pricing and length** come from `booking_settings` / `peak_rates`; the database computes and enforces the
  amount (`quote_court_price`). The client never decides the charged amount.
- RLS, admin checks, the 2-hour cancellation rule, `cancel_reason`, and rate limits stay as they are.

## 6. What is left to the builder

Data model for baskets, the exact RPC(s) for an all-or-nothing hold and confirmation, how Stripe line items are
shown (one line per court is expected), the bottom-sheet component design within the existing grid, migration and
rollback, and test design. Required tests: all-or-nothing hold under a conflicting concurrent booking; per-court
cancel refunds exactly that court's share; late payment with one court lost; a second open basket is refused;
staff cancel/collect on one court of an unpaid basket acts on the whole basket; single-court booking still works
end to end (existing Playwright suite stays green, updated where it relies on 3 open holds).

Admin refunds after an admin cancels one court of a paid basket must refund only that court's share, whichever
data model is chosen for the Stripe ids.
