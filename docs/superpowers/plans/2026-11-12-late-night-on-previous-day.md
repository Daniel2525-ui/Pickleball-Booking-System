# Late-night hours on the previous day — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A day's after-midnight hours (Monday open until 2 AM → 12–2 AM) are shown and booked on that day's grid, never on the next date's, and can be paid together with the day's own hours in one QR Ph checkout.

**Architecture:** Storage stays on real calendar dates; bookings never cross midnight. The customer grid gets the day's own slots, then the tail slots from the next date. A basket line can run across midnight in the UI. At checkout it is split into a D line ending 24:00 and a D+1 line starting 00:00. The checkout API and `hold_court_basket` take a date on each line, check that every line belongs to the basket's business day, and apply the minimum hours to the whole run across midnight.

**Tech Stack:** Next.js 16 App Router, Supabase Postgres (plpgsql), node:test, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-12-late-night-on-previous-day-design.md`

## Global Constraints

- Bookings never cross midnight in storage: 11 PM–12 AM is `booking_date = D, end_time = 24:00`; 12–1 AM is `booking_date = D+1, start_time = 00:00`.
- SQL `bookable_windows`, `within_bookable_hours`, `quote_court_price`, `business_date` stay unchanged.
- TS `bookableWindows` / `windowsForWeekday` keep calendar-date meaning (walk-ins, admin, `isOutsideHours`, hours conflicts, dashboard, showcase use them).
- Prices: quote each stored part with its own real calendar date. Never quote a tail hour with D's date.
- Migration tested only on the local stack (`supabase_db_localdb`). Production apply only after the user says so. Ship a rollback file in `supabase/`.
- Write e2e only through `scripts/e2e-app.sh` on :3200 against local Supabase; `.env.local` is production.
- CRLF files: preserve line endings when editing.
- Deploy order: the migration goes to production before the new app code. Old SQL ignores the per-line dates, so a tail line would be refused (OUTSIDE_OPERATING_HOURS). That fails safely, but a player couldn't book it.

## Review Focus

1. **12:30 AM visitor:** the strip's "Today" is still Monday; Monday's own slots read "passed", 1–2 AM is bookable. → Task 3 unit test on `businessToday` usage via `stripStart`.
2. **Same court 11 PM–1 AM with `min_hours = 2`:** must be accepted (one 2-hour run), while a lone 12–1 AM line is refused. → Task 4 unit test + Task 5 SQL test.
3. **A Tuesday-dated basket posting 00:00–02:00 as Tuesday's own (`booking_date = Tue`, `p_booking_date = Tue`):** refused, because those hours belong to Monday. → Task 5 SQL test.
4. **A 24-hour day (open 00:00, close 00:00):** no tail; its own 12 AM slot is not mistaken for a tail. → Task 1 unit test on `midnightIndex`.
5. **A closed Monday:** Monday's grid is closed *and* 12–2 AM disappear; Tuesday still starts at its opening. A closed Tuesday keeps Monday's tail. → Task 1 unit test.

---

### Task 1: Business-day slots

**Files:**
- Modify: `src/lib/services/schedule/hoursRules.ts` (add `businessDayWindows`)
- Modify: `src/lib/services/schedule/generateTimeSlots.service.ts` (use it)
- Modify: `src/lib/services/bookings/basket.ts` (add `midnightIndex`)
- Test: `tests/hours-rules.test.mjs` (update the generateTimeSlots cases at lines ~100–110, add new ones)

**Interfaces:**
- Produces: `businessDayWindows(date: string, hours: HoursInput[], closedDates?: string[]): { start: string; end: string; date: string; lateNight?: true }[]`. These are D's own window (ending "24:00" for an after-midnight close), then D's tail `{ start: "00:00", end: close, date: D+1, lateNight: true }`. It is empty when D is in `closedDates`.
- Produces: `generateTimeSlots(selectedDate, hours, closedDates)`. Same signature; now returns D's own slots, then its tail slots.
- Produces: `midnightIndex(timeSlots: string[]): number`, the index of the first slot after a slot ending "24:00", or `timeSlots.length` when there is none.

- [ ] **Step 1: Write failing tests** (lateWeek fixture: Fri 2026-11-06 22:00–02:00 … use the existing `lateWeek`; Thursday closes 00:00)
  - `businessDayWindows("2026-11-06", lateWeek)` deep-equals `[{start:"22:00",end:"24:00",date:"2026-11-06"},{start:"00:00",end:"02:00",date:"2026-11-07",lateNight:true}]` (adjust to the fixture's real Friday hours).
  - `businessDayWindows("2026-11-07", lateWeek)` does not contain any `lateNight` window (Saturday no longer shows Friday's tail).
  - `businessDayWindows("2026-11-06", lateWeek, ["2026-11-06"])` → `[]`; `businessDayWindows("2026-11-06", lateWeek, ["2026-11-07"])` still has the tail.
  - 24h day `open("Monday","00:00","00:00")` → `[{start:"00:00",end:"24:00",date:D}]`; `midnightIndex(generateTimeSlots(mon, h24))` === 24 (length).
  - `generateTimeSlots(at("2026-11-06"), lateWeek)` ends with `"11:00 PM - 12:00 AM","12:00 AM - 1:00 AM","1:00 AM - 2:00 AM"`; `generateTimeSlots(at("2026-11-07"), lateWeek)[0]` is `"8:00 AM - 9:00 AM"`.
  - `midnightIndex(["10:00 PM - 11:00 PM","11:00 PM - 12:00 AM","12:00 AM - 1:00 AM"])` === 2.
- [ ] **Step 2: Run** `node --test tests/hours-rules.test.mjs`. Expected: FAIL (businessDayWindows not exported).
- [ ] **Step 3: Implement** `businessDayWindows` from `windowsForWeekday(weekday(D))` (own window) and `windowsForWeekday(weekday(D+1))` (its `lateNight` window), filtered by `closedDates.includes(D)`. Switch `generateTimeSlots` to it. Add `midnightIndex` using `slotTimes`. Update the doc comment on `generateTimeSlots`.
- [ ] **Step 4: Run** `npm test`. Expected: all pass (fix the old Saturday-tail generateTimeSlots assertions to the new behaviour; `bookableWindows` tests stay unchanged).
- [ ] **Step 5: Commit** `feat(hours): a day's slots run on past midnight; the next date drops them`

### Task 2: Splitting a line at midnight

**Files:**
- Modify: `src/lib/services/bookings/basket.ts`
- Test: `tests/basket-lines.test.mjs`

**Interfaces:**
- Produces: `splitAtMidnight(timeSlots: string[], span: readonly [number, number], date: string): { booking_date: string; start_time: string; end_time: string }[]`. It returns 1 or 2 parts: the slots before `midnightIndex` go on `date` (ending at "24:00" when they reach midnight), and the rest go on `shiftDate(date, 1)` starting at "00:00".

- [ ] **Step 1: Failing tests:** slots = Friday's from Task 1.
  - Span over 11 PM–1 AM → `[{booking_date:"2026-11-06",start_time:"23:00",end_time:"24:00"},{booking_date:"2026-11-07",start_time:"00:00",end_time:"01:00"}]`.
  - Span over 12–2 AM only → one part on 2026-11-07, `00:00`–`02:00`.
  - Span over 10–11 PM → one part on 2026-11-06.
- [ ] **Step 2:** `node --test tests/basket-lines.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** with `midnightIndex` + `slotTimes` + `shiftDate` (from `src/lib/utils/bookingTime.ts`).
- [ ] **Step 4:** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(basket): split a picked run at midnight into its two stored days`

### Task 3: The booking page uses the business day

**Files:**
- Modify: `src/components/customers/booking-container.tsx`
- Modify: `src/components/customers/date-selector.tsx:66-69` (`isDayOpen`: own hours only, `windowsForWeekday(...).some((w) => !w.lateNight)`)
- Modify: `src/lib/services/payments/createCheckoutSession.service.ts`

**Interfaces:**
- Consumes: `generateTimeSlots`, `midnightIndex`, `splitAtMidnight`, `businessToday(dayEndsAt, now)`, `shiftDate`.
- Produces: `createCheckoutSession({ bookingDate: string; lines: { court_id: string; booking_date: string; start_time: string; end_time: string }[] }): Promise<string>`. The POST body becomes `{ booking_date, lines }` with a date on each line.

Changes in `booking-container.tsx`. Each one is small; keep the existing structure:
- `tailFrom = midnightIndex(timeSlots)`; `nextDate` = selectedDate + 1 day.
- Bookings: keep `bookings` for D and add `tailBookings` for D+1. Fetch both in the date effect, `refreshBookings` and the failed-checkout refetch (`Promise.all`).
- `getSlotStatus(_date, court, time)`: when `timeSlots.indexOf(time) >= tailFrom`, call `checkSlotAvailability(court, time, courts, tailBookings, nextDate, user?.id)`. `getSlotBooking` in `handleSlotClick` uses `tailBookings` the same way.
- `breaks`: don't count the step from a slot ending "24:00" to one starting "00:00" as a gap.
- `makeLine`: the price is the sum of `quoteCourtPrice(pricing, part.booking_date, part.start_time, hours)` over `splitAtMidnight(...)` parts, and `hasPeak` is true if any part has it. Remove `priceFor`'s single-date use for lines. The grid's `priceOf`/`peakOf` quote a tail slot with `nextDate`.
- `headingOf`: `"After midnight"` for index ≥ `tailFrom`, otherwise `dayName`.
- `confirmBooking`: lines = basket lines flatMapped through `splitAtMidnight(timeSlots, lineSpan(line), selectedDateStr)` with `court_id`. Call `createCheckoutSession({ bookingDate: selectedDateStr, lines })`. The failed-checkout `splitTakenLines` re-check uses the new `getSlotStatus` logic on fresh data.
- Business today: the 7-day strip starts at `businessToday(pricing?.settings.day_ends_at)`, parsed to a local Date. `i === 0` is "Today" and `i === 1` is "Tmrw". On first load (no saved basket), once pricing arrives, if that business day is before the calendar date, select it. `isToday` compares with it too.
- `dayNote(d)`: closed when `generateTimeSlots(d, operatingHours, closedDates).length === 0`. The close text is unchanged.
- The pending-basket restore check (`< today`) compares against the business today.

- [ ] **Step 1:** Make the edits above.
- [ ] **Step 2:** `npx tsc --noEmit` and `npm run lint -- src/components/customers src/lib/services`. Expected: no new errors.
- [ ] **Step 3:** `npm test`. Expected: PASS.
- [ ] **Step 4: Commit** `feat(booking): after-midnight hours sit at the bottom of their own day`

### Task 4: Checkout API takes a date per line

**Files:**
- Modify: `src/lib/services/bookings/validateBookingSlot.service.ts` (`validateBasketLines`)
- Modify: `src/app/api/stripe/checkout/route.ts`
- Test: `tests/multi-hour-booking.test.mjs`

**Interfaces:**
- Consumes: `businessDayWindows` (Task 1).
- Produces: `validateBasketLines({ bookingDate, lines, courts, windows: { start; end; date }[], limits, now? })`. Each input line may carry `booking_date`, defaulting to `bookingDate`. The output lines add `bookingDate: string`.

Rules:
- Each line is checked by `validateBookingSlot` with its own `booking_date`, against only the windows whose `date` equals it, using `limits: { min_hours: 1 }`.
- A line whose date has no window is refused with "The selected time range falls outside venue operating hours."
- After all lines pass, each line's run hours must be ≥ `limits.min_hours`. Run hours are the line's own hours plus those of a same-court line on the other side of midnight: D ending 24:00 joins D+1 starting 00:00. The error names the court and uses the existing min-hours wording.
- The overlap check compares courts and dates.
- Route: `windows: businessDayWindows(booking_date, weeklyHours ?? [])`. Pass `booking_date` on each `p_lines` entry. In `openBasketCheckout`, use `bookingDate: item.booking_date` (Task 5 returns it).

- [ ] **Step 1: Failing tests:** Friday 22:00–02:00 windows from `businessDayWindows("2026-11-06", lateWeek)`, `now` set to the day before.
  - Accepts `[{c1, 2026-11-06, 23:00, 24:00}, {c1, 2026-11-07, 00:00, 01:00}]` with `min_hours: 2`. The output dates are kept.
  - Refuses `[{c1, 2026-11-07, 00:00, 01:00}]` with `min_hours: 2` (error matches `/at least 2 hours/`).
  - Refuses `{c1, 2026-11-07, 02:00, 03:00}` (outside hours) and `{c1, 2026-11-08, 00:00, 01:00}` (outside hours).
  - Refuses two lines on c1 2026-11-07 00:00–02:00 and 01:00–02:00 (overlap). Accepts c1 2026-11-06 23:00–24:00 alongside c1 2026-11-07 00:00–01:00 (different dates, no overlap).
  - Existing tests still pass: a line with no `booking_date` uses `bookingDate`.
- [ ] **Step 2:** `node --test tests/multi-hour-booking.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the rules above and the route changes.
- [ ] **Step 4:** `npm test` and `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(checkout): a basket can hold its day's after-midnight hours`

### Task 5: Database: basket lines carry their date

**Files:**
- Create: `supabase/migrations/20261112140000_late_night_basket.sql`
- Create: `supabase/rollback_late_night_basket.sql`. It restores both functions exactly as production has them now, from the production text read on 2026-11-12, which matches `20261106135055` / `20261106135314` plus the after-midnight patch.
- Create: `tests/integration/late-night-basket.sql`. Use the same self-check style as `tests/integration/after-midnight-hours.sql`: `BEGIN … ROLLBACK`, `pg_temp.fails`.

**Interfaces:**
- Produces: `hold_court_basket(p_booking_date date, p_lines jsonb, p_hold_expires_at timestamptz)`. The signature is unchanged. Each line may carry `booking_date`, defaulting to `p_booking_date`, and each returned item includes `booking_date`.

`CREATE OR REPLACE` both functions starting from production's current text, with these changes only:
- **`hold_court_basket`:**
  - A line's date is `coalesce((e->>'booking_date')::date, p_booking_date)`.
  - Every line must satisfy `public.business_date(line_date, start_time) = p_booking_date`, else `INVALID_ARGUMENT: A time is not on this booking day`.
  - The overlap check adds the same date to its condition.
  - Run check: each line's hours, plus a same-court partner's hours, must be ≥ `booking_settings.min_hours`, else `INVALID_DURATION: Bookings must be at least % hour(s) long`. A partner is the line on line_date+1 starting 00:00 when this one ends 24:00, or the reverse.
  - Loop `ORDER BY court_id, line_date, start_time`, and pass `p_booking_date => v_line.line_date`.
- **`hold_court_booking`:**
  - The min-hours part of check 3 is skipped when `p_basket_id IS NOT NULL AND current_setting('app.hold_basket_id', true) = p_basket_id::text`, because the basket checks whole runs. The whole-hours part always runs.
  - In the basket guard, `booking_date != p_booking_date` becomes `business_date IS DISTINCT FROM public.business_date(p_booking_date, p_start_time)`, and the same-court overlap adds `booking_date = p_booking_date`.

- [ ] **Step 1: Write `tests/integration/late-night-basket.sql`.** Fixture: next week's Friday 22:00–02:00, day_ends_at 04:00, min_hours 2, and a player JWT (`role: authenticated`, `sub` = player). Assertions:
  - Friday basket `[c1 Fri 23:00–24:00, c1 Sat 00:00–01:00]` holds 2 bookings with one basket_id, both with `business_date = Fri`. The total equals `quote_court_price(Fri,'23:00','24:00') + quote_court_price(Sat,'00:00','01:00')`.
  - A Friday basket with `[c2 Sat 00:00–01:00]` alone fails `INVALID_DURATION`.
  - A Saturday basket `p_booking_date = Sat` with `[c2 00:00–02:00]` (no line date) fails `INVALID_ARGUMENT` (those hours are Friday's).
  - A Friday basket with a line on Sun fails `INVALID_ARGUMENT`.
  - A direct `hold_court_booking(c3, Sat, '00:00','01:00', …)` with min 2 still fails `INVALID_DURATION` (the per-line rule holds outside baskets).
  - The old single-date basket `[c3 Fri 22:00–24:00]` still works.
- [ ] **Step 2:** `docker exec -i supabase_db_localdb psql -U postgres -v ON_ERROR_STOP=1 < tests/integration/late-night-basket.sql`. Expected: FAIL (the line date is ignored).
- [ ] **Step 3:** Write the migration and the rollback. Apply locally: `docker exec -i supabase_db_localdb psql -U postgres -v ON_ERROR_STOP=1 < supabase/migrations/20261112140000_late_night_basket.sql`.
- [ ] **Step 4:** Re-run both `tests/integration/late-night-basket.sql` and `tests/integration/after-midnight-hours.sql`. Expected: both finish with `ROLLBACK` and no error.
- [ ] **Step 5:** Check the rollback: apply it, run `after-midnight-hours.sql` (passes), then re-apply the migration.
- [ ] **Step 6: Commit** `feat(db): basket lines carry their date, so a night's hours pay together`

### Task 6: End-to-end on the local stack

**Files:**
- Create: `tests/e2e/late-night.spec.mjs` (uses `local-db.mjs` helpers: `requireLocalDb`, `sql`, `resetBookings`, `requireQrPh`, `payWithQrPh`)

- [ ] **Step 1: Write the spec.** It sets the weekday of tomorrow (Manila) to 08:00–02:00, `day_ends_at` 04:00, min 1. Afterwards it restores the hours and settings with the original values read first.
  - Tomorrow's grid ends with an "After midnight" heading, then "12–1 AM" and "1–2 AM" rows.
  - The day after tomorrow's grid has no "12–1 AM" row and starts at its opening.
  - Picking 11 PM–12 AM then 12–1 AM on one court shows one basket line "11:00 PM - 1:00 AM". Its total equals two hourly prices.
  - Checkout (skips unless `requireQrPh()`) pays, and the DB has two confirmed bookings on that court: tomorrow 23:00–24:00 and the next date 00:00–01:00, with one basket_id.
- [ ] **Step 2:** `bash scripts/e2e-app.sh` and `npx playwright test tests/e2e/late-night.spec.mjs tests/e2e/basket.spec.mjs tests/e2e/booking-flow.spec.mjs tests/e2e/availability.spec.mjs`. Expected: new spec passes (payment part may skip without a Xendit key); the others are no worse than before.
- [ ] **Step 3: Commit** `test(e2e): book a night's hours across midnight in one checkout`

### Task 7: Production (needs the user's OK)

- [ ] Tell the user the migration is ready and wait for an explicit yes. Then apply `20261112140000_late_night_basket.sql` with `mcp__supabase__apply_migration`, re-read both function hashes, and confirm they match local.
