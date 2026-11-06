# My Bookings: One Card per Checkout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On `/my-bookings`, courts bought in one checkout (same `basket_id`) show as one card with a line per court, instead of one card per court.

**Architecture:** Two pure helpers in `src/lib/services/bookings/basket.ts` group the user's bookings by checkout and total them. `booking-history-container.tsx` maps over groups instead of bookings: a one-court group renders the existing card unchanged, a multi-court group renders the same card shell with a court list. No API, query or schema change.

**Tech Stack:** Next.js 16 / React 19 client component, Tailwind v4, `node --test` unit tests, Playwright e2e on the local stack.

**Spec:** Design agreed in chat on 2026-11-06 (mock: scratchpad `my-bookings-mock.html`, not committed). The decisions are restated under Global Constraints; the executor needs nothing else.

## Global Constraints

- Group key is `basket_id` only. `null` `basket_id` (legacy rows, walk-ins) = its own card. Two checkouts on the same date stay two cards.
- One-court cards look exactly as today. Do not restyle them.
- Each court keeps its own `Ref XXXXXX` (`bookingRef(id)`) on its line; front desk looks courts up by it. A multi-court card has no card-level Ref.
- Paid (non-pending) courts in a group are cancelled one at a time: a per-line button, visible text `Cancel`, accessible name `Cancel <court title>` (e.g. `Cancel COURT 1`).
- An unpaid (pending) group keeps one `Continue Payment` and one `Cancel Reservation` button for the whole card; the server already resumes and cancels the whole basket (`/api/bookings/resume-payment`, `/api/bookings/cancel`), and the existing dialog already says `This cancels all N courts in this unpaid booking.`
- A group is in **Upcoming** while any member would be upcoming by today's rule (not `cancelled`/`no_show` and start ≥ now); otherwise **Past**. Tab counts count cards.
- Multi-court card copy: title badge `N COURTS`; time row shows earliest start – latest end of the live (not cancelled/no-show) courts; total label `Total · N courts`, or `Total · L of N courts` when some are cancelled; cancelled lines are struck through with a `CANCELLED` badge and their `cancellationNote(...)` text.
- Ponytail: no new component file, no new dependency, no refactor of the single-card JSX beyond swapping `booking` for the group's lead.

## Review Focus

- Legacy rows with `basket_id: null` must never merge with each other → unit test in Task 1.
- A paid group with one court cancelled stays in Upcoming, keeps the cancelled court visible, and its total drops to the live courts → e2e in Task 2 (after the existing per-court cancel test).
- A pending group's hold expiring (countdown hits zero) must flip every pending court of that basket, not just the lead, or the card shows mixed state until refresh → Task 2 Step 3 widens `onStatusChange`; check by hand in the local preview.
- A group whose first court has already started but whose second has not stays in Upcoming and sorts by its earliest *upcoming* start → covered by the Upcoming rule; check by hand.
- An all-cancelled group (e.g. hold expired) renders as one dashed card in Past with the struck total, like a cancelled single card today → `checkoutTotal` unit test in Task 1 pins the amount.

---

### Task 1: Group and total helpers

**Files:**
- Modify: `src/lib/services/bookings/basket.ts` (append)
- Test: `tests/basket-lines.test.mjs` (append; extend the import on line 3)

**Interfaces:**
- Produces:
  - `groupByCheckout<T extends { id: string; basket_id?: string | null }>(rows: T[]): T[][]` — groups in first-seen order, members keep input order; a `null`/missing `basket_id` row is its own group.
  - `checkoutTotal(group: { status: string; total_amount?: number | null }[]): number` — sum of `total_amount` over members whose status is not `cancelled` or `no_show`; if every member is cancelled/no-show, the sum over all members (so the struck price still shows).

- [ ] **Step 1: Write the failing tests** in `tests/basket-lines.test.mjs`

```js
test("groupByCheckout groups one checkout's courts, in first-seen order; null baskets stay alone", () => {
    const r = (id, basket_id) => ({ id, basket_id });
    const rows = [r("1", "A"), r("2", null), r("3", "B"), r("4", "A"), r("5", null), r("6", undefined)];
    assert.deepEqual(groupByCheckout(rows).map((g) => g.map((x) => x.id)), [["1", "4"], ["2"], ["3"], ["5"], ["6"]]);
});

test("checkoutTotal counts live courts, or every court when all were cancelled", () => {
    const l = (status, total_amount) => ({ status, total_amount });
    assert.equal(checkoutTotal([l("confirmed", 510), l("cancelled", 255), l("confirmed", 300)]), 810);
    assert.equal(checkoutTotal([l("cancelled", 300), l("no_show", 300)]), 600);
    assert.equal(checkoutTotal([l("pending", 300), l("pending", null)]), 300);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL, `groupByCheckout` / `checkoutTotal` not exported.

- [ ] **Step 3: Implement both helpers in `basket.ts`** with the signatures above (a `Map` keyed by `basket_id ?? row.id` gives first-seen order in a few lines).

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: all pass (134: today's 132 + 2).

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/bookings/basket.ts tests/basket-lines.test.mjs
git commit -m "feat(bookings): group a user's bookings by checkout"
```

---

### Task 2: One card per checkout on My Bookings

**Files:**
- Modify: `src/components/customers/booking-history-container.tsx` (list split ~168-184, card map ~272-441; drop the `pendingBasketSize` "Part of a N-court booking" block ~346-350, the dialog's use at ~479 stays)
- Test: `tests/e2e/basket.spec.mjs` (tests at lines 45, 72, 149)

**Interfaces:**
- Consumes: `groupByCheckout`, `checkoutTotal` from Task 1.

- [ ] **Step 1: Write the failing e2e assertions** in `tests/e2e/basket.spec.mjs`

Append to `"a two-court basket is paid in one Stripe checkout and confirms both courts"`:

```js
  await page.goto("/my-bookings");
  await expect(page.getByText("2 COURTS", { exact: true })).toHaveCount(1);
  await expect(page.getByText("Total · 2 courts")).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel COURT 1" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel COURT 2" })).toBeVisible();
```

Append to `"cancelling one paid court refunds only that court, and cannot be repeated"`:

```js
  await page.goto("/my-bookings");
  await expect(page.getByText("2 COURTS", { exact: true })).toHaveCount(1); // still Upcoming, still one card
  await expect(page.getByText("Total · 1 of 2 courts")).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel COURT 1" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cancel COURT 2" })).toBeVisible();
```

In `"a second checkout while a basket awaits payment is refused"`, replace the `"Part of a 2-court booking"` block with:

```js
  await page.goto("/my-bookings");
  await expect(page.getByText("2 COURTS", { exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Cancel Reservation" }).click(); // one button for the unpaid pair
  await expect(page.getByRole("dialog").getByText("This cancels all 2 courts in this unpaid booking.")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Keep Reservation" }).click();
  await expect(page.getByText("2 COURTS", { exact: true })).toHaveCount(1);
```

- [ ] **Step 2: Run to verify they fail** (local stack per `tests/e2e/README.md`: `scripts/e2e-app.sh` in one terminal)

Run: `scripts/e2e-test.sh tests/e2e/basket.spec.mjs --project=desktop`
Expected: FAIL at the first `2 COURTS` assertion.

- [ ] **Step 3: Implement the grouped card** in `booking-history-container.tsx`

- Split: `const groups = groupByCheckout(bookings)`; reuse today's upcoming predicate as `isUpcoming(b)`; `upcomingGroups = groups.filter(g => g.some(isUpcoming))` sorted by each group's earliest upcoming start ascending; `pastGroups` = the rest in query order. Tab counts use `.length` of these.
- In the map: `lead` = first member not `cancelled`/`no_show`, else `group[0]`. Everything the card did with `booking` (status badge, countdown, Continue Payment, cancel dialog target, cutoff text, stub date) now uses `lead`. Key = `lead.basket_id ?? lead.id`.
- `group.length === 1`: today's card, unchanged.
- `group.length > 1`: title badge `${group.length} COURTS`, no card-level Ref; time row = earliest start – latest end of live members (all members if none live); then a `<ul aria-label="Courts in this booking">` with one `<li>` per member: `bookingTitle(m)`, `formatTime12h` start – end, `Ref ${bookingRef(m.id)}`, `₱${m.total_amount}`; a cancelled/no-show member gets a `CANCELLED`/`NO-SHOW` badge, its `cancellationNote(m)?.text`, and a struck price; a per-line `Cancel` button (aria-label `Cancel ${bookingTitle(m)}`, `onClick={() => setBookingToCancel(m)}`) when `lead.status !== "pending" && isBookingCancellable(m, now, cancelCutoffHours)`.
- Footer: amount = `checkoutTotal(group)`; label `Total`, or for groups `Total · N courts` / `Total · L of N courts`. Card-level `Cancel Reservation` shows only for a single card (today's rule) or a pending group (`isBookingCancellable(lead, …)`). The cutoff text shows when `lead` is confirmed and upcoming and no member is cancellable.
- Dashed "sits back" styling: single card as today; group only when every member has a `cancellationNote`.
- `BookingCountdown.onStatusChange`: update `b.id === lead.id` **or** (`lead.basket_id` and `b.basket_id === lead.basket_id` and `b.status === "pending"`), so an expired hold flips the whole basket.
- Delete the `"Part of a N-court booking"` paragraph (the `N COURTS` badge replaces it); keep `pendingBasketSize` for the dialog.

- [ ] **Step 4: Run to verify they pass**

Run: `npx tsc --noEmit -p . && npm test && scripts/e2e-test.sh tests/e2e/basket.spec.mjs tests/e2e/booking-flow.spec.mjs tests/e2e/journey.spec.mjs tests/e2e/open-play.spec.mjs tests/e2e/admin-walk-in.spec.mjs tests/e2e/admin-cancel-keep.spec.mjs`
Expected: tsc clean; unit tests pass; all listed specs pass (the other five read My Bookings with one-court bookings and must be unaffected).

- [ ] **Step 5: Check by hand at 390px and 1280px** on the local app: a paid 2-court checkout, the same after cancelling one court, a pending 2-court checkout, and a single booking. Lines must not overflow on a 390px phone.

- [ ] **Step 6: Commit**

```bash
git add src/components/customers/booking-history-container.tsx tests/e2e/basket.spec.mjs
git commit -m "feat(my-bookings): one card per checkout, a line per court"
```
