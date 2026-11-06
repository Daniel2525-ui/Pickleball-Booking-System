# Courts Showcase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An "Our courts" section on the customer landing page (`/`) in the agreed "B · Featured court" layout: one big picture of the selected court, a list of courts beside it with a live status each, and a Book button.

**Architecture:** A pure helper decides each court's status right now from the court row, today's public slots and today's opening hours. A client component renders the layout with a drawn court diagram as the picture, loads today's public slots on mount and every 60 seconds, and the landing page passes it the courts and today's hours it already queries.

**Tech Stack:** Next.js 16 / React 19, Tailwind v4, Supabase (anon client), `node --test`, Playwright on the local stack.

**Spec:** Agreed in chat on 2026-11-06 (mock: scratchpad `courts-showcase-mock.html`, version B). Decisions restated under Global Constraints.

## Global Constraints

- Layout B: big picture of the selected court (left/top), list of every court (right/below); tapping a list row selects it. Heading "Our courts".
- Picture = the drawn top-down court diagram (placeholder for a real photo later). No photo upload, no new DB column now.
- No detail tags ("Indoor", "LED lights"): the system has no such data.
- No facts row in the section: the existing "The venue" strip directly below already shows courts count, price and cancel policy (no duplicates).
- Status labels, exactly: `In play` (court booked right now), `Free now`, `Maintenance` (court.status maintenance), `Closed` (court.status closed), `Closed now` (venue outside today's hours or closed today).
- Status detail, exactly: in play → `Free from <time>` (end of the run of back-to-back bookings); free → `Free until <time>` (next booking start) or `No more bookings today`; maintenance → the court's `maintenance_note`, else `Not bookable right now`; venue closed → `Opens <time>` if it opens later today, else `Closed for the day`.
- Book button: `Book <Court name>` links to `#booking`; hidden for maintenance/closed courts.
- Guests see no player details: data only from `get_public_slot_availability` and the public `courts` read.
- Venue values come from the database (resold to many venues): court names, count and hours are never hard-coded.

## Review Focus

- A court with back-to-back bookings (3–4 PM and 4–5 PM) reads "Free from 5:00 PM", not 4:00 → unit test in Task 1.
- Someone else's pending hold (RPC returns it with `hold_expires_at` masked to null) still counts as taken → unit test in Task 1.
- At 11 PM, after closing, no court says "Free now" → unit test in Task 1.
- More than 4 courts or a long court name must not break the list on a 390px phone → manual check in Task 2.
- Zero courts: the section is not shown → Task 2 renders nothing for an empty list.

---

### Task 1: Court status helper

**Files:**
- Create: `src/lib/services/courts/courtShowcase.ts`
- Test: `tests/court-showcase.test.mjs`

**Interfaces:**
- Consumes: `getBookingStart`, `getBookingEnd` from `src/lib/utils/bookingTime.ts`; `formatTime12h` from `src/lib/utils/formatTime.ts`.
- Produces:
  - `type ShowcaseState = "busy" | "free" | "off"`
  - `courtShowcaseStatus(court: { id: string; status: string | null; maintenance_note?: string | null }, slots: { court_id: string | null; start_time: string; end_time: string; status?: string }[], hours: { is_open: boolean; open_time: string | null; close_time: string | null } | null, today: string, now: Date): { state: ShowcaseState; label: string; detail: string }`
  - `slots` are today's rows from `get_public_slot_availability`; that RPC already drops expired holds, so every row returned counts as taken.

- [ ] **Step 1: Write the failing tests** (`today = "2026-11-07"`, `at = (hm) => new Date(\`${today}T${hm}:00+08:00\`)`, hours 08:00–22:00 open)
  - court maintenance with note "Resurfacing" → `{ state: "off", label: "Maintenance", detail: "Resurfacing" }`; without note → detail `Not bookable right now`; status `closed` → label `Closed`.
  - at 23:00 → `{ state: "off", label: "Closed now", detail: "Closed for the day" }`; at 07:00 → detail `Opens 8:00 AM`; `is_open: false` → `Closed for the day`.
  - slots 15:00–16:00 and 16:00–17:00 (one `pending`) at 15:30 → `{ state: "busy", label: "In play", detail: "Free from 5:00 PM" }`.
  - slot 18:00–19:00 at 15:30 → `{ state: "free", label: "Free now", detail: "Free until 6:00 PM" }`; no slots → detail `No more bookings today`; another court's slot is ignored.

- [ ] **Step 2: Run** `npm test` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement `courtShowcaseStatus` in `src/lib/services/courts/courtShowcase.ts`.** Build slot Dates with `getBookingStart/End({ booking_date: today, ... })`; extend the busy run while the next slot starts at the current end.

- [ ] **Step 4: Run** `npm test` — Expected: all pass.

- [ ] **Step 5: Commit** `feat(courts): live status for the landing page court showcase`

---

### Task 2: "Our courts" section on the landing page

**Files:**
- Create: `src/components/customers/courts-showcase.tsx`
- Modify: `src/app/page.tsx` (courts query; render the section between the booking section and "The venue")
- Test: `tests/e2e/courts-showcase.spec.mjs`

**Interfaces:**
- Consumes: `courtShowcaseStatus` (Task 1); `fetchBookingsForDate` (`src/lib/services/bookings/fetchBookingsForDate.service.ts`); `formatManilaDate`, `getBookingWeekday`.
- Produces: `<CourtsShowcase courts={{ id, name, status, maintenance_note }[]} hours={OperatingHour[]} />` (client component).

- [ ] **Step 1: Write the failing e2e test** `"guests see every court with its status and can switch the featured court"`: reset bookings; insert a confirmed booking on the first court covering now (Manila) and set the second court to maintenance with note "Resurfacing" (restore after); visit `/`; expect `getByRole("region", { name: "Our courts" })` to contain the first court's row with "In play", the second with "Maintenance"; click the second court's row → the featured caption shows its name and "Resurfacing", and no `Book <name>` link; click the first → `Book <first name>` link with `href="#booking"`.

- [ ] **Step 2: Run** `scripts/e2e-test.sh tests/e2e/courts-showcase.spec.mjs` — Expected: FAIL, region not found.

- [ ] **Step 3: Build the section.** Page: replace the head-only courts count with `select("id, name, status, maintenance_note").order("name")` and derive `courtCount` from its length; render `<CourtsShowcase>` only when courts exist. Component: section `aria-label="Our courts"`, heading "Our courts", one-line lede, featured panel (drawn court SVG, `aria-hidden`; name; status pill + detail; Book link) and a list of `<button aria-pressed>` rows (small SVG, name, pill); statuses recomputed from slots loaded on mount and every 60 s, and the clock re-read each tick. Layout stacks on phones.

- [ ] **Step 4: Run** `npx tsc --noEmit -p . && npm test && scripts/e2e-test.sh tests/e2e/courts-showcase.spec.mjs tests/e2e/availability.spec.mjs` — Expected: clean, all pass.

- [ ] **Step 5: Check by hand** at 1280px and 390px, including a 6-court list.

- [ ] **Step 6: Commit** `feat(landing): Our courts showcase with live status`
