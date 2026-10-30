# GCash manual payment — design

## Intent

Most local players would rather pay with GCash than a card, and card-only checkout (Stripe) loses them. Players should choose **Card** or **GCash** at checkout. GCash is a **manual transfer**: the player sends money to the club's own GCash account, submits proof, and an admin verifies it. The owner chose manual over a payment provider because the money lands directly in the club's GCash, no new provider or fees are needed, and nothing confirms until a person has checked it.

Success: a player without a card can book and pay in GCash end to end, and an admin can confirm or reject that payment from the existing admin pages.

## Goals

- Player picks Card or GCash on the basket review step. Card behaves exactly as today.
- GCash pay screen (one page) shows the club's GCash details, the exact basket total, and a form requiring **both** a reference number and a receipt screenshot.
- After submitting proof, the booking(s) show as **Awaiting verification** and the slots stay held until an admin acts. The cleanup cron must not release them.
- Admin verifies from the Bookings table: Approve → paid and confirmed (same end state as a card booking). Reject → booking(s) cancelled and slots released.
- Admins edit the club's GCash details (account name, number, QR image) on a new **Settings** page in the admin sidebar.

## Non-goals

- No GCash payment provider or API integration (PayMongo, Xendit, Stripe GCash, etc.).
- No email or SMS notifications. Players see the outcome in **My bookings**. (The app sends no email today.)
- No automated refund for GCash. Refunds happen by hand in GCash; the site only records them through whatever the admin refund flow already allows.
- No changes to the Stripe card flow.
- No GCash details on the authenticated user's profile tab. They belong to the club, not to one admin.

## Anti-goals (would be a failure even if it works)

- A player can see another player's receipt screenshot, or anyone who isn't an admin can view screenshots.
- A booking with submitted GCash proof gets auto-released by the cleanup cron before an admin decides.
- Players are shown the GCash option while the club's GCash details are empty. They would pay into nothing.
- Approving or rejecting one court of a multi-court basket leaves its siblings in a different state.

## The flow as decided

### Player

1. **Basket review**: a "Pay with" choice of Card / GCash, then Continue. GCash is hidden when the club's GCash details are not configured.
2. **GCash pay screen** (single page, chosen over a two-step layout):
   - "Send exactly ₱{total} to:", then the QR image, account name, and number with a copy button.
   - A note that the slots are held for a limited time while they pay.
   - **GCash reference no.** (required) and **Receipt screenshot** upload (required, image).
   - Submit payment.
3. **Confirmation**: "Payment submitted. We're checking your GCash payment. Your slots are held until the club confirms." Shows reference and amount.
4. **My bookings**: each court shows the status **Awaiting verification**, then Confirmed or Cancelled after an admin acts.

Mockup reference: `.superpowers/brainstorm/5425-1793378039/content/gcash-player-flow.html` (gitignored, local only).

### Hold timing

- **Before proof is submitted**: the normal hold applies (about 30 minutes, same as card). A player who picks GCash and walks away is released by the existing cleanup cron as usual.
- **After proof is submitted**: the slot is held **indefinitely until an admin approves or rejects**. The owner explicitly accepted that an unverified booking can block a slot overnight. Reject is the remedy for fake references.
- **Start time passes while unverified (owner decided):** the booking is **not** auto-cancelled. An admin can still **approve after the start time**, including at the court when the player shows their GCash receipt. Until it is approved, the booking cannot be checked in or move through game-day statuses. Note that `settle_counter_payment` currently raises `MATCH_START_PASSED` and `HOLD_EXPIRED` (see `supabase/migrations/20261029044804_booking_cancel_reason.sql`), so GCash approval needs its own RPC or a GCash-verification branch that skips those two checks for awaiting-verification payments. Counter settlement keeps its current rules. Reject also stays available after the start time.
- **One open booking per player (owner decided):** the existing one-open-basket rule (`OPEN_BASKET_EXISTS` in `hold_court_booking`) **still applies while a basket is awaiting verification**. A player cannot start another booking until their GCash basket is approved or rejected. Whatever represents "awaiting verification" must keep that rule in force. Booking UI should tell the player why they're blocked, for example "Your GCash payment is being verified".

### Admin

- **Bookings table** (`src/components/admin/bookings/bookings-table.tsx`): an **Awaiting verification** filter with a count, a status badge on those rows, and a **Verify** action.
- **Verify popup**: customer, number of courts, expected amount, the receipt screenshot (tap to enlarge), reference number, submitted time. Two actions:
  - **Approve — mark paid**: every court in the basket becomes paid (payment_method `gcash`, reference stored) and confirmed.
  - **Reject & release slots**: every court in the basket is cancelled and the slots are released.
- A multi-court basket paid with one GCash transfer is verified as one unit. Opening Verify from any of its rows shows the same check, matching how `settle_counter_basket` and basket cancellation already work.

Mockup reference: `.superpowers/brainstorm/5425-1793378039/content/gcash-admin-verify.html`.

### Admin Settings page

- New sidebar item **Settings** (`src/components/admin/AppSidebar`), next to the other club-wide pages (Pricing, Operating Hours).
- A **GCash payments** section: account name, GCash number, QR code image upload. Editable any time and stored in the database, never hardcoded.
- Only admins can read or write the settings through admin paths. Players receive the GCash name, number and QR only on the GCash pay screen.

## Constraints and existing pieces to build on

- **Counter GCash already exists.** `SettlePaymentModal` and `settle_counter_payment` / `settle_counter_basket` record `payment_method = 'gcash'` with a payment reference for walk-in settlement. Approve should reuse this settlement path, or match its end state exactly, rather than invent a second "paid via GCash" representation. Payments and Revenue reporting then shows online-GCash and counter-GCash consistently.
- **Holds and availability.** Pending bookings occupy a slot only while `hold_expires_at` (plus `hold_release_after` grace) is in the future. The cron (`src/app/api/cron/cleanup-expired-bookings/route.ts`) cancels `status = 'pending'` rows past their hold, and it inspects Stripe sessions first. An awaiting-verification booking must (a) keep occupying its slot in `hold_court_booking` and public slot availability, and (b) be skipped by the cron. It also must not be treated as a Stripe session the cron tries to retrieve or expire.
- **Stripe reconciliation** (`confirm_checkout_hold`, reconcile RPCs) assumes `payment_method` is null or `stripe` for online payments. A GCash basket must never be opened as a Stripe Checkout, and Stripe reconciliation must not touch it.
- **Customer cancel** (`customer_cancel_pending_only` migration) lets customers cancel pending bookings. The builder decides whether a player can cancel while Awaiting verification. See "Left to the builder."
- **RLS is on for core tables.** New tables and storage buckets need RLS or storage policies to match: players insert proof only for their own pending basket, admins read everything, nobody else reads screenshots.
- **Storage.** The app doesn't use Supabase Storage yet. Screenshots go in a **private** bucket, and admins view them via signed URLs. The QR image can be public-read, since it is shown to every paying player anyway, or private and served signed. Builder's call.
- **Trust boundaries.** Validate on the server: the reference is non-empty with a sane length and character set; the screenshot is an image type under a size cap; the proof belongs to the caller's own basket; the basket is still pending and within its hold when proof is submitted; the amount is taken from the server-side basket total and never from the client.
- **Next.js version.** Per `AGENTS.md`, read `node_modules/next/dist/docs/` before writing route or page code.
- Migrations go in `supabase/migrations/`, following the existing naming.

## Calls I made (owner did not explicitly decide; easy to change)

- Settings is a **separate sidebar item**, not the profile tab. The owner offered either; the profile is per-admin and GCash details are club-wide.
- GCash is **hidden at checkout** when settings are incomplete.
- Proof submission is only accepted while the original hold is still live. After the hold expires the player must rebook. This avoids reviving a slot someone else may have taken.
- The pre-proof hold length matches the current card hold.
- Approve and reject are **all-or-nothing per basket**.
- No notifications beyond the status in My bookings.
- **Payment method is locked once the hold is created.** Continue with GCash creates the hold (no Stripe session) and records GCash as the basket's method. If the player leaves before submitting proof, My bookings' resume action brings them back to the GCash pay screen, never Stripe. To switch to Card they cancel the pending booking (existing customer cancel) and rebook. `/api/bookings/resume-payment` and the My bookings resume button must branch on the method.
- The QR image is optional. Name and number are required for GCash to be offered.

## Left to the builder

- How to represent "awaiting verification" in data. Options include a new booking status, a payment status (for example `pending` with a `submitted_at` timestamp), or clearing or extending `hold_expires_at`. Any of these works if every constraint above holds: slot stays occupied, cron skips it, Stripe paths ignore it, admin filter and My bookings can show it. Prefer the option that touches the fewest existing RPCs.
- Where proof lives (columns on `payments` vs a small proof table) and the settings table shape (a single-row club settings table is fine).
- Whether players may cancel their own booking while Awaiting verification. Suggested: no, since money may already be sent; they contact the club.
- Whether a rejected booking records a cancel reason (a `booking_cancel_reason` column already exists). Suggested: yes, for example "GCash payment could not be verified", visible in My bookings.
- Duplicate-reference guard. Suggested: warn the admin in the Verify popup if the same reference was used on another booking. Don't block it.
- Exact copy, icons and styling, following the existing admin and customer UI.
- Tests: at minimum, the cron skips awaiting-verification bookings, approve and reject affect every row in the basket, and a non-owner cannot submit proof or read a screenshot.
