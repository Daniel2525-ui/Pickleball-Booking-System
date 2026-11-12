# Guest checkout, discount codes and number of players

## Intent

Other court booking systems (CourtReserve Public Booking, the Pickle Town Metro form the user showed) let a
player pay with a short details form; an account is optional. Forced sign-up is one of the top reasons people
abandon a checkout. The user asked for the same here, plus a discount code and a number of players at checkout,
with the admin side to manage both:

- "lets make it that way same as other pickleball booking systems, a form for guestcheckout making the signing up for an account optional"
- "also add discount code and numbers of players, add logic to those as well in the admin side"

## Goals

1. A guest fills name, phone, email and number of players (and optionally a discount code) in the checkout
   dialog and pays with QR Ph, without creating an account.
2. A signed-in player sees the same dialog minus the details they already have (players and discount code only).
3. A guest can create an account afterwards and keep the bookings they made as a guest.
4. Admins create, edit, switch off and see the use of discount codes.
5. Admins set the most players a court takes; every booking shows its number of players to staff.
6. The server enforces all of it: the discount and the player count cannot be faked from the browser.

## Non-goals (named, skipped)

- No phone or email verification code at checkout (user did not pick one; my recommendation: QR Ph payment is the
  real commitment, plus rate limits). Can be added later.
- No notes field, no per-player pricing, no service fee.
- No discount on open play spots, walk-ins or admin-made bookings.
- No per-customer discount limits (guests have no stable identity); limits are per code.
- No players field on the admin walk-in form (staff add walk-ins; the count is optional there and stays empty).
- Guest bookings made on one device are not visible on another device until the guest creates an account
  (the confirmation email carries the booking details).

## Anti-goals

- A guest booking that disappears (the 7-day cleanup of unconfirmed users must not delete guests or their bookings).
- A discount that makes the QR Ph amount differ from what the database recorded (payment would fail to reconcile).
- A code used more times than its limit because two players checked out at the same moment.
- Anything applied to production without the user's OK.

## Decisions

### Guest checkout: Supabase anonymous sign-in (my call)

- On "Pay" with no session, the browser calls `supabase.auth.signInAnonymously()`; the guest then has a real,
  `authenticated` session, so every existing ownership check (hold, QR page, payment verify, status, resume,
  cancel, My Bookings on that device) works unchanged.
- The checkout route, when the caller is anonymous (`user.is_anonymous`), requires `guest: { full_name, phone,
  email }`, validates it (name 2–100 chars, PH mobile `09XXXXXXXXX` or `+639XXXXXXXXX` normalised to `09…`,
  email format) and upserts the guest's `profiles` row with the service role: `role = 'customer'`,
  `is_guest = true`, name/phone/email. A profile also stops `delete_stale_unconfirmed_users` from deleting them.
- Anonymous checkouts are rate limited per IP (existing `checkRateLimit`, 10 per hour). Supabase also limits
  anonymous sign-ins (30 per hour per IP by default).
- Creating an account later: on `/register`, a signed-in anonymous user is converted with
  `supabase.auth.updateUser({ email, password, data: { full_name, phone } })` instead of signing up, so the
  same user id keeps the bookings. On email confirmation `handle_new_user` now updates the existing profile
  (`is_guest = false`, email) instead of skipping it. If the email already has an account, say so and offer
  sign-in (the guest bookings stay on the guest session; known limit).
- UI: the "Sign in to pay" dialog becomes the checkout details dialog with "Have an account? Sign in". The
  account menu shows "Guest" and "Create an account" for an anonymous session. The success page offers
  "Create an account to keep track of your bookings" to guests.
- Admin: bookings and details show "Guest (no account)" for `profiles.is_guest`.
- Production prerequisite: the user switches on Authentication → Sign In / Providers → "Allow anonymous
  sign-ins" in the Supabase dashboard (cannot be done from here). Local stack: enable the same flag.

### Number of players

- `booking_settings.max_players_per_court` integer, default 8, 1–30, edited on the admin Settings page.
- `bookings.player_count` integer, nullable (old bookings, walk-ins), `> 0`.
- One number per checkout, required online, `1 ≤ n ≤ max_players_per_court × number of distinct courts`
  in the basket; stored on every booking row of the basket. Checked in the API and in `hold_court_basket`
  (`p_player_count`).
- Staff see it in the bookings table, the booking details panel and today's schedule on the dashboard.

### Discount codes

- Table `discount_codes`: `id`, `code` (stored upper-case, unique, 3–20 of `A-Z 0-9 -`), `kind`
  (`percent` | `fixed`), `value` (percent 1–100, fixed > 0 pesos), `active`, `starts_on`/`ends_on` (optional
  Manila dates, inclusive), `max_uses` (optional), `created_at`, `created_by`. RLS: admins read and write;
  nobody else reads the table (codes are checked through functions).
- `bookings.discount_code_id`, `bookings.discount_amount numeric(10,2) default 0`.
- A use is one checkout (basket) whose bookings are confirmed, checked in, completed, no-show, or a pending
  hold not yet released. Counted from the bookings, not a counter, so cancelled or expired holds give the use back.
- `hold_court_basket(…, p_player_count, p_discount_code)`: locks the code row (`FOR UPDATE`, so two checkouts
  can't both take the last use), checks active, date window (today in Manila), uses < max; after holding the
  lines it applies the discount: percent → each line minus `round(amount × value / 100, 2)`; fixed → taken from
  the lines in hold order until used up. If the discounted total is 0 or less it refuses
  ("This code covers the whole booking: ask the front desk"). It updates each booking's `total_amount`,
  `discount_amount`, `discount_code_id` and its payment's `amount`, and returns discounted amounts, so the
  QR Ph charge equals what the database records.
- Errors start with `DISCOUNT_INVALID: <reason>` (unknown, switched off, not started, ended, used up,
  covers whole booking); the route shows the reason.
- Preview: `check_discount_code(p_code, p_subtotal)` (security definer, callable by anon and authenticated)
  returns `{ valid, reason, discount }` for the dialog's Apply button; rate limited by IP in its route.
  The hold re-checks everything.
- Admin page `/admin/discounts` (sidebar): list with code, discount, dates, uses / max, on/off switch;
  create form; edit max uses, dates and on/off. Code, kind and value are fixed once a code has been used.
  Same staff access as the pricing page. Each code shows its recent uses (date, player, amount off).

## Tests

- Unit: guest details validation and phone normalisation; player-count bounds; percent and fixed discount
  split (rounding, fixed larger than one line, total reaching 0 refused).
- SQL self-check (local, rolled back): code limits (inactive, dates, max uses, concurrent last use via
  lock order), amounts written to bookings and payments, player count bounds, guest profile kept by cleanup,
  `handle_new_user` updating a guest profile on confirmation.
- e2e (local): guest checks out without an account (holds made; payment branch skipped without a Xendit key);
  wrong code shows the reason; admin creates a code and sees its use; admin sets max players and the
  checkout enforces it.

## Left to the builder

File layout, component split, exact copy, where on the dashboard the player count sits.
