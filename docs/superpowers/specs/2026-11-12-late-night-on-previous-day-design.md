# Late-night hours belong to the day before

## Intent

A venue that sets Monday to close at 2 AM means "Monday night runs until 2 AM".
Today the booking grid shows 12–2 AM at the top of **Tuesday's** grid, so a player
browsing Tuesday sees hours that are really Monday night, and a player on Monday
can't book 11 PM through 1 AM in one go. The user's words:

- "late night schedule should not be seen in the current day booking"
- "if monday was set to open up until 2 am … it should not be able to be booked by tomorrow"
- On edge cases: "do what is best, make sure no bugs will appear in this implementation"

## How other booking systems do it (research, 2026-11-12)

- **Roller** (venue software) has exactly this setting: "Sessions that run from 12:00 AM to
  2:00 AM early Saturday morning will appear in checkouts as starting on Friday night." The
  late end is tied to the day's closing time in operating hours. This is the model we follow.
- **Oracle OSCAR** calls it a booking day that differs from the calendar day: a venue closing
  at 3 AM counts 00:00–03:00 as the previous day's bookings. That matches our `day_ends_at`.
- **Lightspeed POS** does the same for sales reports ("start of business day"), set an hour or
  two after closing. That matches our earnings by `business_date`.
- **Playtomic** puts a booking that crosses midnight on both calendar days and needs a separate
  price range from 00:00 to the real close. Its docs warn that blocks past 00:00 aren't read
  correctly. **CourtReserve** cuts every booking at midnight; 24/7 clubs have asked for a fix
  that hasn't shipped. **Square** shows past-midnight slots on the next date, and merchants
  complain about it. That is our current behaviour.
- **BookingPress** labels past-midnight slots "+1 Day". We use the "After midnight" heading
  for the same job.

## Goals

1. Monday's grid lists Monday's own hours, then 12–1 AM and 1–2 AM at the bottom
   under an "After midnight" heading (same heading style the grid already uses).
2. Tuesday's grid starts at Tuesday's opening time. It never shows Monday's tail.
3. A player can put Monday 11 PM–12 AM and Monday-night 12–2 AM in one basket and
   pay once (one QR Ph payment).
4. The server enforces the same thing: a booking at Tuesday 00:00–02:00 is only
   accepted as part of Monday's grid (it is Monday's window), never offered as Tuesday.
   Direct API calls can't book outside the windows either.
5. Every label reads as Monday: grid, basket, checkout, confirmation, emails,
   My Bookings, admin. These already use `business_date` / `lateNightOf`; they must keep working.

## Non-goals

- No change to how bookings are stored. A booking never crosses midnight: 11 PM–12 AM
  is stored on Monday ending 24:00, 12–1 AM is stored on Tuesday's date. The exclusion
  constraint, cron, reports and earnings (which group by `business_date`) stay as they are.
- No change to the hours editor or `checkWeeklyHours` (an after-midnight close still
  requires "Day ends at" ≥ the close; so any venue with late hours has `day_ends_at` > 00:00).
- No change to the admin Add Booking modal's date logic beyond what breaks (see Builder notes).
- Open play is untouched.

## Anti-goals (would be a failure even if it "works")

- A late-night slot shows on both days, or on neither.
- A basket can be paid partly (two payments, or one half held and the other not).
- A Tuesday 12–2 AM booking made by a player shows up as "Tuesday" anywhere.
- Price of the late tail follows Tuesday's rates instead of Monday's.
- Any change applied to the production database without the user's explicit OK.

## Decisions (my calls, delegated by the user)

- **"Today" at 12:30 AM Tuesday** is still Monday's business day: the day strip's
  "Today" is `businessToday(day_ends_at)`, so the player sees Monday's grid with the
  rest of tonight (12:30 AM onward still bookable, past slots greyed as now). Tuesday
  appears as "Tmrw". Without this, a player at 12:30 AM could not book 1–2 AM at all.
- **A closed date** removes that day's own hours *and* its tail (closing Monday closes
  Monday night). A closure on Tuesday does not remove Monday's tail. This is already the
  rule (`bookableWindows` filters the tail by the previous date; SQL
  `block_closed_date_booking` uses `business_date`). It just moves along with the tail.
- **The grid's rows across midnight stay separate lines** in storage; the basket and
  payment treat them as one checkout. The client must split runs at midnight explicitly:
  `breaks` won't do it, because 11 PM ends at 12 AM and the tail starts at 12 AM, so
  `mergeSpans` would otherwise join them into one impossible line.
- **Pricing needs no change.** Pass each line's real calendar date (Tuesday 00:00).
  `hourlyRate` in TS and `quote_court_price` in SQL already map it to Monday through
  business_date. Passing Monday with 00:00 would wrongly price it as Sunday.
- **Min/max hours count the whole run across midnight**, per court. 11 PM–1 AM is a
  2-hour booking, so a venue with min 2 hrs accepts it. 10 PM–2 AM is 4 hrs against max.
  The per-line check in `hold_court_booking` moves to `hold_court_basket` for basket
  holds: it joins a court's line ending 24:00 on D with its line starting 00:00 on D+1.
  Direct `hold_court_booking` calls keep the per-line check. The client's `minHours`
  checks in `booking-container.tsx` and `basket-sheet.tsx` count the same way.
  (My call: per stored line would block 11 PM–1 AM at any venue with a 2-hour minimum.)

## How (the shape, decided)

### Client

- `bookableWindows(date, hours, closedDates)` (hoursRules.ts): for `date` D returns D's own
  window(s), then D's after-midnight tail as `{ start, end, lateNight: true, date: D+1 }`
  at the end. It no longer returns the previous day's tail. Callers that need the
  "what is open on this calendar date" view (the dashboard timeline, courts showcase,
  `openNowLabel`) must be checked and kept on calendar-date semantics.
- `generateTimeSlots` builds slot labels from those windows; each slot knows its real
  calendar date (D or D+1).
- `booking-container.tsx` fetches bookings for D and, when D has a tail, for D+1, and
  checks a tail slot against D+1's bookings only.
- Basket lines carry their own real `date`. A basket may hold D lines and D+1 tail lines
  only (one business day). Changing the selected day already empties the basket, so
  this needs no new code.
- Day strip "Today" = business today.

### Server

- `/api/stripe/checkout` accepts per-line dates. Validation: every line's date is
  `booking_date` or `booking_date + 1`; `+1` lines must fall inside `booking_date`'s
  tail window; same-day lines inside its own window. `validateBasketLines` gets the
  windows with dates.
- `hold_court_basket` (new migration): lines may carry `booking_date`, default
  `p_booking_date`. Every line must have `business_date(line_date, start) = p_booking_date`,
  which refuses a "Tuesday" basket for 00–02. Its same-court overlap check gets the date
  added to the key, and so does the overlap check in `hold_court_booking`'s basket guard. That guard's
  `booking_date != p_booking_date` becomes a `business_date` comparison.
- SQL `bookable_windows(p_date)` stays on calendar dates, unchanged. hold, walk-in,
  move and open-play generation all depend on it, and a Tuesday-dated 00:00 line passes it.
  A direct `hold_court_booking` call for Tuesday 00–02 is still possible. It is stored with
  business date Monday, so it reads as Monday everywhere. Accepted; no extra guard.
- The checkout route passes each line's own date into `openBasketCheckout` (it currently
  passes `booking_date` for every line), so the QR Ph description and the emails show the
  right time.
- Migration file tested on the local stack only. Production apply only after the user OKs it.

## Tests

- Unit (tests/hours-rules.test.mjs): Monday open 8 AM–2 AM → Monday windows end with the
  tail on Tuesday's date; Tuesday windows start at Tuesday's open; Monday closed date
  drops the tail; Tuesday closed date keeps Monday's tail; venue with no late hours unchanged.
- Unit: checkout validation accepts D + D+1 tail, rejects D+1 outside the tail, rejects D+2.
- SQL (local): hold_court_basket with Monday 11 PM + Tuesday 00–02 on the same court
  holds both in one basket at Monday prices; a Tuesday-only 00–02 basket posted as
  Tuesday is refused; with min_hours = 2, Monday 11 PM–12 AM + Tuesday 00–01 on one court
  is accepted, while a lone 1-hour line is refused; 10 PM–2 AM is refused when max_hours = 3.
- e2e (local :3200): set Monday to close at 2 AM (Day ends at 4 AM), open Monday's grid,
  see After midnight rows at the bottom, Tuesday's grid has none, book 11 PM–1 AM in one
  checkout (skips without Xendit test key, as the payment tests do).

## Left to the builder

- Exact names and file layout; whether the per-line date travels as `date` or `booking_date`.
- How the admin Add Booking modal shows the tail (it uses the same windows; it must not break).
- The visual of the "After midnight" heading beyond reusing the existing one.
