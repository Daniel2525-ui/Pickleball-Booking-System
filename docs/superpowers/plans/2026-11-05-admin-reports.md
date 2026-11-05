# Admin Reports Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Admin-only `/admin/reports` page showing revenue, bookings, busy hours, per-court use and best customers for any period, with a CSV download, exactly as the approved mockup.

**Architecture:** One read-only Postgres function `public.get_venue_report(p_from date, p_to date) returns jsonb` computes every number (owner check inside, `SECURITY INVOKER`). A small TypeScript module turns the period picker into dates, percentages and CSV. The page is a client container like Pricing/Settings that calls the function through `supabase.rpc` and draws plain HTML/CSS charts (no chart library), gated by the existing owner-only proxy rule and sidebar flag.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind v4, Supabase (Postgres RPC, RLS), `node --test` unit tests, Playwright e2e on the local stack.

**Spec:** `docs/superpowers/specs/2026-11-05-admin-reports-design.md` (definitions section is binding); mockup `docs/superpowers/specs/2026-11-05-admin-reports-mockup.html`.

## Global Constraints

- Admins only: `is_owner = true`. Front desk (`role = 'admin'`, `is_owner = false`) and players get `FORBIDDEN`.
- Venue day = Asia/Manila date. Money dated by `payments.paid_at`.
- Net revenue = sum of `status = 'paid'` amounts; refunds are never subtracted again.
- No new tables, no new dependencies, no writes.
- Migrations: write `supabase/migrations/admin_reports.sql` plus `supabase/rollback_admin_reports.sql`; production is applied only when the user says so, then renamed to the recorded version and `scripts/dump-schema.sh` re-run.
- UI copy: plain English, as in the mockup. Tables use the shared `@/components/ui/table`; loading uses `Skeleton`.
- e2e runs only via `scripts/e2e-test.sh` against the local stack on :3200 (`scripts/e2e-app.sh`).

## Review Focus

1. **A refunded payment** must appear under Refunded and nowhere in Net revenue; one day's net must equal the Payments page "Collected" for that day. Test in Task 1.
2. **Manila midnight:** a payment at 11:30 PM Manila on Oct 31 (15:30 UTC) belongs to October, not November. Test in Task 1.
3. **Empty or closed periods:** no bookings, no payments, or every day closed must give zeros and `occupancy.pct = null`, never a division error; previous value 0 must show no percentage. Tests in Tasks 1 and 2.
4. **Closures and closed weekdays** reduce open court-hours; a `venue_closures` date contributes 0. Test in Task 1.
5. **Open play:** spot purchases count as Open play money, not as court bookings; open-play court blocks count as booked court-hours. Test in Task 1.

---

### Task 1: `get_venue_report` database function

**Files:**
- Create: `supabase/migrations/admin_reports.sql`, `supabase/rollback_admin_reports.sql`
- Test: `tests/e2e/admin-reports-data.spec.mjs`

**Interfaces:**
- Produces: `public.get_venue_report(p_from date, p_to date) returns jsonb`. `p_from` NULL = all time (start at the earliest booking date or paid date; today if none). `p_to` NULL = today (Manila). Raises `FORBIDDEN: Admin privileges required` (ERRCODE 42501) unless `public.is_owner()`; raises `INVALID_ARGUMENT` (22000) when `p_to < p_from` or the span exceeds 3660 days. Returned JSON, keys exactly:

```json
{
  "period": { "from": "2026-10-01", "to": "2026-10-31", "through": "2026-10-31", "bucket": "day" },
  "money": { "net": 0, "cash": 0, "gcash": 0, "card": 0, "refunded": 0, "refunded_count": 0, "court": 0, "open_play": 0 },
  "bookings": { "count": 0, "court_hours": 0, "cancelled": 0, "no_shows": 0, "money_kept": 0 },
  "previous": { "net": 0, "count": 0, "cancelled_and_no_shows": 0 },
  "occupancy": { "pct": null, "booked_hours": 0, "open_hours": 0 },
  "courts": [{ "id": "uuid", "name": "COURT 1", "pct": 58 }],
  "heatmap": [{ "dow": 0, "hour": 6, "pct": 12 }],
  "series": [{ "key": "2026-10-01", "net": 0, "cash": 0, "gcash": 0, "card": 0, "refunded": 0, "bookings": 0, "court_hours": 0 }],
  "top_customers": [{ "name": "Maria Santos", "visits": 0, "hours": 0, "spent": 0, "last_visit": "2026-10-30" }]
}
```

Rules not fixed by the spec's definitions: `through` = least(`to`, today); occupancy, `courts` and `heatmap` use days `from..through`; `bucket` = `'day'` when the span is ≤ 62 days, else `'month'` (`key` `YYYY-MM`); `series` has one row per bucket in range, zero rows included; `previous` is `null` when `p_from` is NULL; `pct` values are whole numbers 0–100, `occupancy.pct` null when `open_hours = 0`; `heatmap.dow` 0 = Monday … 6 = Sunday, hours from the earliest open to the latest close across open weekdays, cells with no open hours omitted; card = any paid method other than `cash`/`gcash` (as `sumPayments`); `top_customers` max 5, by spent desc then visits desc, grouped by `user_id`, else `customer_id`, else lower(`customer_name`), named by profile name / customer name / booking name; `close_time = '00:00'` counts as 24:00. `REVOKE ALL … FROM PUBLIC, anon`; `GRANT EXECUTE … TO authenticated`.

- [ ] **Step 1: Write the failing tests** in `tests/e2e/admin-reports-data.spec.mjs`. Seed with `sql()` in a fixed past month (`2026-09`) using `firstCourt()` and the CUSTOMER account; reset with `resetBookings()` in before/after. Call the function through a signed-in supabase-js client (copy `signedIn(role)` from `tests/e2e/admin-gcash.spec.mjs`). Tests and their assertions:
  - `the owner gets September's money right`: seed paid cash 400 (paid 2026-09-10 10:00 Manila), paid gcash 200, paid stripe 300, refunded stripe 250, pending 999, failed 500, open-play spot payment paid 150 by gcash (booking with `court_id` null and an `open_play_session_id`) → `money` equals `{ net: 1050, cash: 400, gcash: 350, card: 300, refunded: 250, refunded_count: 1, court: 900, open_play: 150 }`.
  - `a refunded payment never reduces net twice`: for 2026-09-10, `series` row `net` equals the paid sum computed by `sumPayments`-style SQL for that Manila day (`paid` only).
  - `a payment at 11:30 PM Manila on the last day stays in that month`: payment `paid_at = '2026-09-30 15:30:00+00'` → included in `get_venue_report('2026-09-01','2026-09-30')` and absent from `('2026-10-01','2026-10-31')`.
  - `bookings, cancellations, no-shows and money kept`: 3 completed 1-hour bookings, 1 no-show with paid 200, 1 cancelled `customer`, 1 cancelled `payment_kept` with paid 200, 1 cancelled `expired`, 1 pending hold → `bookings` = `{ count: 4, court_hours: 4, cancelled: 2, no_shows: 1, money_kept: 400 }`.
  - `closures and closed weekdays reduce open hours`: set all weekdays 06:00–22:00 open except Sunday closed, add `venue_closures` 2026-09-15, 4 courts; for `('2026-09-14','2026-09-20')` → `occupancy.open_hours = 4 * 16 * 5`; an open-play court block 19:00–21:00 on 2026-09-16 adds 2 to `booked_hours`.
  - `an empty period is all zeros`: `('2026-08-01','2026-08-31')` with no rows → `money.net = 0`, `bookings.count = 0`, `top_customers = []`, `series` has 31 rows; with every weekday closed → `occupancy.pct = null`.
  - `previous period and buckets`: `previous.net` for `('2026-09-08','2026-09-14')` equals the 7 days before; all-time call has `previous = null`; a 90-day range has `bucket = 'month'`.
  - `only the owner can run it`: CUSTOMER → error containing `FORBIDDEN`; CUSTOMER2 made front desk (`role='admin', is_owner=false`, restored in `finally`) → `FORBIDDEN`; `p_to < p_from` → `INVALID_ARGUMENT`.
  - `top customers group walk-ins`: two walk-in bookings paid 200 each under one `customer_id`, and one CUSTOMER account booking paid 200 → walk-in row `{ visits: 2, hours: 2, spent: 400 }` first, the account's player second with `spent: 200`.

- [ ] **Step 2: Run to verify they fail**
  Run: `scripts/e2e-test.sh tests/e2e/admin-reports-data.spec.mjs --project=desktop`
  Expected: FAIL with `Could not find the function public.get_venue_report`.

- [ ] **Step 3: Write `supabase/migrations/admin_reports.sql`** creating the function per the Interfaces block and the spec definitions (`LANGUAGE sql` or `plpgsql`, `STABLE`, `SET search_path TO ''`), and `supabase/rollback_admin_reports.sql` dropping it. Apply locally: `docker exec -i supabase_db_localdb psql -U postgres -v ON_ERROR_STOP=1 < supabase/migrations/admin_reports.sql`.

- [ ] **Step 4: Run the tests to verify they pass** (same command). Expected: all PASS.

- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/admin_reports.sql supabase/rollback_admin_reports.sql tests/e2e/admin-reports-data.spec.mjs
git commit -m "feat(reports): get_venue_report database function"
```

---

### Task 2: Period, comparison and CSV helpers

**Files:**
- Create: `src/lib/services/reports/reports.ts`
- Test: `tests/reports.test.mjs`

**Interfaces:**
- Consumes: the JSON shape from Task 1.
- Produces (all exported from `src/lib/services/reports/reports.ts`):
  - `type PeriodKey = "week" | "month" | "last_month" | "custom" | "all"`
  - `type VenueReport` — the Task 1 JSON as TypeScript (numbers as `number`, nullable as `| null`).
  - `periodRange(key: PeriodKey, today: string, custom?: { from: string; to: string }): { from: string | null; to: string }` — dates `YYYY-MM-DD`; week = Monday through Sunday containing `today`; month = 1st through last day of today's month; last_month = the whole previous month; all = `{ from: null, to: today }`; custom returns `custom` as given.
  - `pctChange(current: number, previous: number | null | undefined): number | null` — whole-number percent, `null` when previous is 0, null or undefined.
  - `reportCsv(report: VenueReport): string` — header `Date,Bookings,Court hours,Cash,GCash,Card,Refunded,Net` then one line per `series` row, `\n` line ends, numbers unformatted, header `Month` instead of `Date` when `bucket = 'month'`.
  - `fetchVenueReport(from: string | null, to: string): Promise<{ data: VenueReport | null; error: string | null }>` — `supabase.rpc("get_venue_report", { p_from: from, p_to: to })`, error text `"Could not load the report. Please try again."`.
  - `todayManila(): string` — `new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date())`.

- [ ] **Step 1: Write the failing tests** in `tests/reports.test.mjs` (import from `../src/lib/services/reports/reports.ts` like `tests/payment-totals.test.mjs`):
  - `periodRange("week", "2026-11-05")` → `{ from: "2026-11-02", to: "2026-11-08" }`; `("week", "2026-11-08")` (a Sunday) → same week.
  - `periodRange("month", "2026-11-05")` → `{ from: "2026-11-01", to: "2026-11-30" }`; `("last_month", "2026-03-15")` → `{ from: "2026-02-01", to: "2026-02-28" }`; `("last_month", "2026-01-10")` → `{ from: "2025-12-01", to: "2025-12-31" }`.
  - `periodRange("all", "2026-11-05")` → `{ from: null, to: "2026-11-05" }`.
  - `pctChange(112, 100)` → `12`; `pctChange(5, 0)` → `null`; `pctChange(5, null)` → `null`; `pctChange(90, 100)` → `-10`.
  - `reportCsv` on a two-row day report → exactly `"Date,Bookings,Court hours,Cash,GCash,Card,Refunded,Net\n2026-10-01,3,4,400,200,0,0,600\n2026-10-02,0,0,0,0,0,0,0\n"`; with `bucket: "month"` the first header cell is `Month`.

- [ ] **Step 2: Run to verify they fail** — Run: `node --test tests/reports.test.mjs`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** the exports above in `src/lib/services/reports/reports.ts` (date maths on `YYYY-MM-DD` strings via `Date.UTC`, never local time; Supabase client from `@/lib/supabase` as other admin services).

- [ ] **Step 4: Run to verify they pass** — `node --test tests/reports.test.mjs` then `npm test`. Expected: all PASS.

- [ ] **Step 5: Commit**
```bash
git add src/lib/services/reports/reports.ts tests/reports.test.mjs
git commit -m "feat(reports): period, comparison and CSV helpers"
```

---

### Task 3: The Reports page, owner-only

**Files:**
- Create: `src/app/(admin)/admin/reports/page.tsx` (server page with the sticky header, copy of the Pricing page layout; title `Reports | Admin`; header "Reports", subtitle "How the venue is doing. Numbers include only money actually collected.")
- Create: `src/components/admin/reports/reports-container.tsx` (client: period picker, CSV button, loading/error/data states, the sections below)
- Create: `src/components/admin/reports/revenue-chart.tsx`, `busy-heatmap.tsx`, `breakdown-bars.tsx` (labelled horizontal bars used by "Where the money came from" and "Each court"), `top-customers.tsx`
- Modify: `src/proxy.ts:27` — add `reports` to the owner-only path regex: `/^\/admin\/(pricing|settings|reports)(\/|$)/`
- Modify: `src/components/admin/app-sidebar.tsx` — add `{ title: "Reports", url: "/admin/reports", ownerOnly: true, icon: BarChart3 }` to `managementNav` after "Payments & Revenue"
- Test: `tests/e2e/admin-reports.spec.mjs`

**Interfaces:**
- Consumes: everything from Task 2; `StatCard` from `@/components/admin/dashboard/stat-card` for the four tiles (`trendType` positive when `pctChange > 0`, negative when `< 0`; for cancellations the colours are reversed); `formatCurrency` as used by the Payments page.

UI rules from the mockup and the dataviz rules: period picker is a row of toggle buttons with `aria-pressed`; Custom shows two `<input type="date">` labelled "From" and "To" (To defaults to today; From must not be after To — show "Pick a start date on or before the end date." and don't load); default period "This month". Revenue chart: single lime series, bars with 4px rounded tops, 2px gaps, hover/focus shows `title` and an `aria-label` like `Oct 25: ₱11,800`; subtitle names the best bucket; all-zero period shows "No money came in during this period." instead of an empty chart. Heatmap: one hue, five steps from `bg-muted` to `bg-primary`, legend "Quiet … Full", each cell `aria-label` "`Mon 6 PM: 64% booked`". Text never wears the series colour. Loading shows `Skeleton` blocks in the same layout; an RPC error shows the error text with a "Try again" button. "All time" hides comparison lines. CSV button downloads `reports-<from or 'all-time'>-to-<to>.csv` built by `reportCsv` (Blob + temporary link), disabled while loading.

- [ ] **Step 1: Write the failing tests** in `tests/e2e/admin-reports.spec.mjs` (seed one September booking set like Task 1; restore in `finally`):
  - `the owner opens Reports from the sidebar and sees the numbers`: login ADMIN, click sidebar link "Reports", pick Custom From `2026-09-01` To `2026-09-30`, expect tile text `₱1,050` under "Net revenue", "Cash" row `₱400`, best customer row name visible, a chart bar with `aria-label` starting `Sep 10:`.
  - `CSV matches the screen`: click "Download CSV", read the download → first line `Date,Bookings,Court hours,Cash,GCash,Card,Refunded,Net`, 31 data lines, the `2026-09-10` line ends with the seeded net.
  - `front desk and players can't open Reports`: CUSTOMER2 as front desk → `/admin/reports` redirects away from the page (same assertion style as Pricing in `tests/e2e/admin-staff.spec.mjs`) and no "Reports" sidebar link; CUSTOMER → not on `/admin/reports`.
  - `an empty month says so`: Custom `2026-08-01`–`2026-08-31` → "No money came in during this period." visible and tiles show `₱0`.
  - `custom range the wrong way round is refused`: From `2026-09-30`, To `2026-09-01` → "Pick a start date on or before the end date." visible.

- [ ] **Step 2: Run to verify they fail** — `scripts/e2e-test.sh tests/e2e/admin-reports.spec.mjs --project=desktop`. Expected: FAIL (no "Reports" link).

- [ ] **Step 3: Implement** the files above.

- [ ] **Step 4: Run to verify they pass**, then `npx tsc --noEmit -p .`, `npx eslint src`, and `scripts/e2e-test.sh tests/e2e/admin-staff.spec.mjs --project=desktop` (sidebar/proxy change). Expected: all PASS.

- [ ] **Step 5: Look at it.** Screenshot `/admin/reports` at 1440×900 and 390×844 for This month and All time; compare with the mockup; fix overflow, label collisions and phone stacking (tiles 2×2, sections single column).

- [ ] **Step 6: Commit**
```bash
git add "src/app/(admin)/admin/reports" src/components/admin/reports src/proxy.ts src/components/admin/app-sidebar.tsx tests/e2e/admin-reports.spec.mjs
git commit -m "feat(reports): owner-only Reports page"
```

---

### Task 4: Full check and production (user-gated)

**Files:**
- Modify (after production apply only): rename `supabase/migrations/admin_reports.sql` → `supabase/migrations/<version>_admin_reports.sql`; `supabase/schema.sql` via `bash scripts/dump-schema.sh`.

- [ ] **Step 1: Full suite** — `npm test` and `scripts/e2e-test.sh`. Expected: all pass (the one time-of-day skip in `admin-policy.spec.mjs` is allowed).
- [ ] **Step 2: Stop and ask the user** "apply the Reports migration to production?" Do not apply without a yes.
- [ ] **Step 3: On yes** — apply with `mcp__supabase__apply_migration` (name `admin_reports`, body without BEGIN/COMMIT), read the recorded version from `supabase_migrations.schema_migrations`, rename the file, run `bash scripts/dump-schema.sh`, verify `has_function_privilege('anon','public.get_venue_report(date,date)','EXECUTE')` is false.
- [ ] **Step 4: Commit** the rename and snapshot; push only when the user says so.
