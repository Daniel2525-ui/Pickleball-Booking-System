# Walk-in Slot Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the admin "Add booking" modal, staff pick start and end times from the venue's real hourly slots for the chosen court and date instead of typing free times.

**Architecture:** A pure helper builds the start and end options from operating hours, closures, court status and that date's bookings. The modal loads that data with the services the customer page already uses and renders two `Select`s. The database function `create_walk_in_booking` stays the final check and is not changed.

**Tech Stack:** Next.js client component, existing shadcn `Select`, Supabase services already in `src/lib/services`, `node --test` for unit tests.

**Spec:** Agreed in chat on 2026-11-06: "take the times from the system's real slots, not free text"; no custom-time escape hatch (Claude's call; user did not ask for one).

## Global Constraints

- Slots are whole hours, from the day's `open_time` to `close_time` (`hoursRules.ts` already forces whole hours on save).
- Past slots **earlier today stay selectable**: the modal records them as played (`20261105034947_walk_in_played_today.sql`, the blue "already ended" note). Do not hide them.
- Dates before today stay blocked (date input `min={formatManilaDate()}` already does this).
- Booking length must stay between `pricing.settings.min_hours` and `max_hours`.
- No change to the database or to `createWalkInBooking`; its error messages stay as the backstop.
- Unit tests import source with relative `.ts` paths (no `@/` alias), like `tests/multi-hour-booking.test.mjs`.

## Review Focus

1. **A booking starts in the middle of a possible range** (e.g. 10:00 is booked; staff pick start 08:00, max 4h). End options must stop at 10:00, not offer 11:00/12:00. Covered in Task 1 test `ends stop before the next taken hour`.
2. **Expired or cancelled pending holds** must not block a slot. Reuse `isBookingActive`; covered in Task 1 test `ignores inactive bookings`.
3. **Staff change court or date after picking times**, and the old times are no longer valid. The modal must clear start/end when they are not in the new options (Task 2, Step 2).
4. **Closed venue date, closed weekday, or court in maintenance/closed** shows no slots and a plain message instead of an empty dropdown (Task 1 test `no starts when closed`; Task 2 message).
5. **Today, late in the day**: past starts are listed and still pickable, and the existing "recorded as played" note still appears. Covered in Task 1 test `past starts today stay selectable`.

---

### Task 1: Slot option helper

**Files:**
- Create: `src/lib/services/bookings/walkInSlots.ts`
- Test: `tests/walk-in-slots.test.mjs`

**Interfaces:**
- Consumes: `isBookingActive(b: BookingSlot, now: Date): boolean` from `./checkSlotAvailability.service.ts`; `BookingSlot` type from `./fetchBookingsForDate.service.ts` (type-only import); `getBookingWeekday(date: string): string` from `./validateBookingSlot.service.ts`.
- Produces:

```ts
export interface WalkInSlotInput {
  date: string;                 // "YYYY-MM-DD"
  courtId: string;
  courtStatus: string;          // Court["status"]; "closed" | "maintenance" give no slots
  hours: { day_of_week: string; is_open: boolean; open_time?: string | null; close_time?: string | null }[];
  closedDates: string[];        // venue_closures.closed_on values
  bookings: BookingSlot[];      // fetchBookingsForDate(date).data
  minHours: number;
  maxHours: number;
  now?: Date;                   // for isBookingActive; defaults to new Date()
}
export interface StartOption { time: string; taken: boolean } // time "HH:MM"
export function walkInStarts(input: WalkInSlotInput): StartOption[];
export function walkInEnds(input: WalkInSlotInput, start: string): string[]; // "HH:MM", ascending
```

Rules: starts are every whole hour from open to `close - minHours`. A start is `taken` when an active booking on `courtId` overlaps `[start, start+1h)`. Ends run `start+minHours … start+maxHours`, capped at close, and stop before any hour overlapping an active booking. A taken start returns no ends. A closed date, closed weekday or unavailable court returns `[]` from both functions.

- [ ] **Step 1: Write the failing tests** in `tests/walk-in-slots.test.mjs`. Use a base input: date `"2026-11-09"` (a Monday), hours Monday open `"08:00:00"` close `"12:00:00"`, court `"c1"` status `"available"`, min 1, max 3, no closures, no bookings.

```js
test("starts cover open to close minus min length", () => {
  assert.deepEqual(walkInStarts(base).map(s => s.time), ["08:00","09:00","10:00","11:00"]);
});
test("booked hour is marked taken", () => {
  const b = { ...base, bookings: [{ id: null, court_id: "c1", start_time: "09:00:00", end_time: "10:00:00", status: "confirmed" }] };
  assert.deepEqual(walkInStarts(b).filter(s => s.taken).map(s => s.time), ["09:00"]);
});
test("other court's booking does not block", () => { /* court_id "c2" → no taken starts */ });
test("ignores inactive bookings", () => { /* status "cancelled" → no taken starts */ });
test("ends stop before the next taken hour", () => {
  const b = { ...base, bookings: [{ id: null, court_id: "c1", start_time: "10:00:00", end_time: "11:00:00", status: "confirmed" }] };
  assert.deepEqual(walkInEnds(b, "08:00"), ["09:00","10:00"]);
});
test("ends respect max length and closing", () => {
  assert.deepEqual(walkInEnds(base, "08:00"), ["09:00","10:00","11:00"]);
  assert.deepEqual(walkInEnds(base, "11:00"), ["12:00"]);
});
test("min length above 1 hour", () => {
  const b = { ...base, minHours: 2 };
  assert.deepEqual(walkInStarts(b).map(s => s.time), ["08:00","09:00","10:00"]);
  assert.deepEqual(walkInEnds(b, "10:00"), ["12:00"]);
});
test("no starts when closed", () => {
  assert.deepEqual(walkInStarts({ ...base, closedDates: ["2026-11-09"] }), []);
  assert.deepEqual(walkInStarts({ ...base, courtStatus: "maintenance" }), []);
  assert.deepEqual(walkInStarts({ ...base, date: "2026-11-10" }), []); // Tuesday has no hours row
});
test("past starts today stay selectable", () => {
  // helper has no notion of "passed": with now after 10:00 the 08:00 start is still offered, not taken
  const b = { ...base, now: new Date("2026-11-09T10:30:00+08:00") };
  assert.equal(walkInStarts(b).find(s => s.time === "08:00").taken, false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/walk-in-slots.test.mjs`
Expected: FAIL, cannot find module `walkInSlots.ts`.

- [ ] **Step 3: Implement `walkInStarts` and `walkInEnds`** in `src/lib/services/bookings/walkInSlots.ts` per the rules above. Compare times as zero-padded `"HH:MM"` strings, the same way `getOverlappingBookings` does (`start_time.slice(0,5)`). Keep one shared private `dayWindow(input)` that returns `{ open, close }` hours or `null`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/walk-in-slots.test.mjs` → all pass. Then `npm test` → whole suite passes.

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/bookings/walkInSlots.ts tests/walk-in-slots.test.mjs
git commit -m "feat(bookings): walk-in slot options from hours, closures and bookings"
```

### Task 2: Use the picker in the Add booking modal

**Files:**
- Modify: `src/components/admin/bookings/AddBookingModal.tsx` (data loading near lines 101-107, `updateFee`/time handlers 142-157, the "Times Grid" block 477-498)

**Interfaces:**
- Consumes: `walkInStarts`, `walkInEnds`, `WalkInSlotInput` (Task 1); `fetchOperatingHours()` (`@/lib/services/schedule/fetchOperatingHours.service`); `fetchUpcomingClosures()` (`@/lib/services/schedule/venueClosures.service`); `fetchBookingsForDate(date)` (`@/lib/services/bookings/fetchBookingsForDate.service`).
- Produces: nothing new for other code.

- [ ] **Step 1: Load the data.** On open, add `fetchOperatingHours()` and `fetchUpcomingClosures()` to the existing effect (state `hours`, `closedDates`). In a new effect keyed on `[open, date]`, load `fetchBookingsForDate(date)` into `dayBookings` when `date` is set.

- [ ] **Step 2: Derive options and clear stale picks.** Build `slotInput` from `courtId`, the chosen court's `status`, `date`, `hours`, `closedDates`, `dayBookings` and `pricing.settings.min_hours/max_hours`. `starts = walkInStarts(slotInput)`, `ends = startTime ? walkInEnds(slotInput, startTime) : []`. When `startTime` is not an untaken start, or `endTime` is not in `ends`, clear it (and the fee is recomputed by `updateFee`). Changing the start clears `endTime` unless it is still in the new `ends`.

- [ ] **Step 3: Replace the two `<Input type="time">`** with two `Select`s using the same markup pattern as the court select above them (ids `walkin-start` / `walkin-end` stay for the labels). Show times with the existing `formatTime12h`. Taken starts are rendered `disabled` with a " · Booked" suffix. Both selects are disabled until court and date are chosen; end is disabled until start is chosen. When court and date are chosen but `starts` is empty, show a one-line muted message under the grid: "No open slots for this court on this date."

  Leave `updateFee` and the "recorded as played" note as they are; both keep working on the `"HH:MM"` values.

- [ ] **Step 4: Verify.** Run `npx tsc --noEmit` and `npm run lint` → no new errors. Then check by hand on the **local stack on :3200 against local Supabase** (never `.env.local`, which is production):
  - pick a court and date with one existing booking → that hour shows "Booked" and can't be picked;
  - pick a start two hours before that booking → end options stop at the booking's start;
  - pick a closed date or a maintenance court → message shows, no options;
  - today after some hours have passed → past starts are listed, choosing one shows the "recorded as played" note and saving works;
  - change the date after picking times → start/end clear.

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/bookings/AddBookingModal.tsx
git commit -m "feat(bookings): admin picks walk-in times from real slots"
```
