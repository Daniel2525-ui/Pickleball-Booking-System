# Launch Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four developer-side launch gaps: lock down the court-block trigger function, make the venue name one setting, add branded 404/error pages and a link preview, and add Sentry error monitoring.

**Architecture:** The venue name and city come from two `NEXT_PUBLIC_` env vars read once in `src/lib/brand.ts`, with today's values as defaults so the current deployment changes nothing. The root layout's metadata uses a title template, so pages set only their own title. The 404, error and link-preview files are Next.js file conventions under `src/app/`, built from `brand.ts`. Sentry hooks into `src/instrumentation.ts` and `src/instrumentation-client.ts`, and captures every server `console.error` through its console integration. Without `SENTRY_DSN` it does nothing.

**Tech Stack:** Next.js 16.4.5 (App Router, React 19, React Compiler), Supabase Postgres, `next/og` `ImageResponse`, `@sentry/nextjs`, `node --test`.

**Spec:** the conversation of 2026-11-09 ("Still open on my side", items 1–4), plus the monitoring decision: **Sentry**.

## Global Constraints

- Read `node_modules/next/dist/docs/` before writing Next.js code (AGENTS.md). Error boundaries in this version receive `{ error: unknown, retry: () => void }`, **not** `reset`. `global-error.tsx` must render its own `<html>` and `<body>`.
- Production Supabase is `fpqipekjhcmrjozqmgwb`. Apply migrations there with `apply_migration`, then rename the migration file to the version production records (house rule).
- Every migration gets a `supabase/rollback_<name>.sql`.
- Defaults must keep today's look: `VENUE_NAME` defaults to `Crosshair Dinkers`, `VENUE_CITY` to `Butuan City`.
- Internal identifiers stay: the `crosshair` theme/CSS class, the `Crosshair` lucide icon, and the `crosshair:pending-basket` storage key. Changing them would reset players' baskets and themes.
- No new dependency except `@sentry/nextjs`.
- Sentry: `sendDefaultPii: false`. Init is a no-op when the DSN env var is empty.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Work happens in the worktree `../pb-polish` (branch `feat/launch-polish`, made from `origin/main`). Push to `main` only after the user approves.

## Review Focus

1. **One-word venue name** (e.g. `NEXT_PUBLIC_VENUE_NAME=Smashville`): the two-tone header must still render, with the whole word in the accent colour and no empty span. Tested in Task 2 (`splitBrandName`).
2. **Blank or whitespace env value**: falls back to the default name, never an empty title. Tested in Task 2 (`brandName`).
3. **Name with `&` or an apostrophe** (e.g. `Dink & Drive`, `Joe's Courts`) in titles and the link-preview image: plain text, no HTML entities shown. Tested in Task 2 (`brandName` keeps it verbatim); checked visually in Task 5.
4. **`SENTRY_DSN` unset** (every local run, and any client that skips Sentry): build passes, no network calls, no console noise. Checked in Task 4, step 5.
5. **Personal data in error reports**: `console.error` lines can carry emails or phone numbers. Keep `sendDefaultPii: false`; do not attach request bodies. Checked in Task 4 review.

---

### Task 1: Lock down the court-block trigger function

**Files:**
- Create: `supabase/migrations/20261109140000_revoke_trigger_execute.sql` (renamed to the production version after applying)
- Create: `supabase/rollback_revoke_trigger_execute.sql`

**Interfaces:** none.

- [ ] **Step 1: Write the migration**

`REVOKE EXECUTE ON FUNCTION public.reject_blocked_court_booking() FROM PUBLIC, anon, authenticated;` with a header comment: the function is a trigger and was never meant to be called through the API; PostgreSQL checks EXECUTE when the trigger is created, not when it fires. The rollback grants EXECUTE back to `PUBLIC`.

- [ ] **Step 2: Apply to production** (`apply_migration`, name `revoke_trigger_execute`), then rename the file to the version `supabase_migrations.schema_migrations` records.

- [ ] **Step 3: Verify the privilege is gone**

```sql
select has_function_privilege('anon', 'public.reject_blocked_court_booking()', 'execute') as anon,
       has_function_privilege('authenticated', 'public.reject_blocked_court_booking()', 'execute') as authed;
```
Expected: `anon=false, authed=false`.

- [ ] **Step 4: Verify the trigger still fires.** Re-run the rolled-back DO block from the court-blocks check: insert a block on day `current_date + 300` from 18:00 to 20:00, insert an overlapping booking, and end with `RAISE EXCEPTION 'RESULT ...'`. Expected: `overlapping_insert=refused: SLOT_UNAVAILABLE`, and afterwards 0 rows in `court_blocks`.

- [ ] **Step 5: Re-run the security advisors.** Expected: no `reject_blocked_court_booking` finding.

- [ ] **Step 6: Commit** — `fix(db): trigger-only function no longer callable through the API`

---

### Task 2: Venue name as one setting

**Files:**
- Create: `src/lib/brand.ts`
- Create: `tests/brand.test.mjs`
- Create: `.env.example` (`main` has none). List every var the app reads: Supabase URL, anon key, service role key, `CRON_SECRET`, the Stripe keys and webhook secret, `RESEND_API_KEY`, `EMAIL_FROM`, `NEXT_PUBLIC_VENUE_NAME`, `NEXT_PUBLIC_VENUE_CITY`, `NEXT_PUBLIC_SITE_URL`, `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`. Placeholders only.
- Modify: `src/app/layout.tsx` (title template, `metadataBase`)
- Modify: every visible-text use from `git grep -n "Crosshair Dinkers" -- src` (about 35 lines in 26 files; the full list is in the conversation). Page `metadata.title` values drop the ` | Crosshair Dinkers` suffix, because the template adds it.
- Modify: the three two-tone headers: `src/components/customers/public-header.tsx:56`, `src/app/(auth)/layout.tsx:27`, and the admin wordmarks `src/components/admin/app-sidebar.tsx:118` and `src/app/(admin)/admin/layout.tsx:27`.
- Leave `src/lib/venue.ts` as it is: its `play@crosshairdinkers.com` is only the fallback until Settings loads, and the guard test is case-sensitive, so it doesn't trip.

**Interfaces:**
- Produces, in `src/lib/brand.ts`:
  - `brandName(raw: string | undefined, fallback: string): string`: trims; blank → fallback.
  - `splitBrandName(name: string): { lead: string; accent: string }`: last word is `accent`, the rest (trimmed) is `lead`; one word → `lead: ""`.
  - `export const VENUE_NAME: string` = `brandName(process.env.NEXT_PUBLIC_VENUE_NAME, "Crosshair Dinkers")`
  - `export const VENUE_CITY: string` = `brandName(process.env.NEXT_PUBLIC_VENUE_CITY, "Butuan City")`
  - `export const SITE_URL: string | undefined` = `process.env.NEXT_PUBLIC_SITE_URL?.trim() || undefined`
  - Must use literal `process.env.NEXT_PUBLIC_*` reads, so Next inlines them into client bundles.

- [ ] **Step 1: Write the failing tests** in `tests/brand.test.mjs` (import `../src/lib/brand.ts`):
  - `brandName(undefined, "X") === "X"`, `brandName("   ", "X") === "X"`, `brandName("  Dink & Drive ", "X") === "Dink & Drive"`, `brandName("Joe's Courts", "X") === "Joe's Courts"`
  - `splitBrandName("Crosshair Dinkers")` deep-equals `{ lead: "Crosshair", accent: "Dinkers" }`
  - `splitBrandName("Smashville")` deep-equals `{ lead: "", accent: "Smashville" }`
  - `splitBrandName("The Kitchen Club")` deep-equals `{ lead: "The Kitchen", accent: "Club" }`
  - **Guard test**: read every file under `src/` (recursive `fs.readdirSync`) except `src/lib/brand.ts`, and assert none contains the literal `Crosshair Dinkers` (case-sensitive). The failure message lists the offending files.

- [ ] **Step 2: Run** `node --test tests/brand.test.mjs`. Expected: FAIL (module missing, then guard lists about 26 files).

- [ ] **Step 3: Implement `src/lib/brand.ts`** per the Interfaces block.

- [ ] **Step 4: Root layout.** Set `metadata.title` to `{ default: VENUE_NAME, template: \`%s | ${VENUE_NAME}\` }`. Add `metadataBase: SITE_URL ? new URL(SITE_URL) : undefined`.

- [ ] **Step 5: Replace each occurrence.**
  - Copy text: `{VENUE_NAME}` in JSX, a template literal in strings.
  - "Crosshair Dinkers Butuan City" and "Butuan City" copy: `${VENUE_NAME} ${VENUE_CITY}` / `{VENUE_CITY}`.
  - "Crosshair Dinkers Complex": `{VENUE_NAME}`.
  - Two-tone headers: `const { lead, accent } = splitBrandName(VENUE_NAME)`, then `{lead && <>{lead} </>}<span className="text-primary">{accent}</span>`.
  - The `resume-payment` fallback court name becomes `` `${VENUE_NAME} court` ``.
  - `bookingTime.ts` doc comment: "venue local time" with no name.

- [ ] **Step 6: Run** `node --test tests/brand.test.mjs`, then `npm test`, `npx tsc --noEmit -p .` and `npx eslint src`. Expected: all pass, the guard finds nothing.

- [ ] **Step 7: Commit** — `feat(brand): venue name and city from one setting (NEXT_PUBLIC_VENUE_NAME / _CITY)`

---

### Task 3: Branded 404, error pages and link preview

**Files:**
- Create: `src/app/not-found.tsx`. Server component: big "404", "This page isn't on the court" style copy, a button back to `/` ("Back to courts"), `metadata.title = "Page not found"`. Use the same header/brand pieces as the customer pages (`PublicHeader`).
- Create: `src/app/error.tsx` (`"use client"`). Props are `{ error: unknown; retry: () => void }`. Body: "Something went wrong", a "Try again" button calling `retry()`, and a link home. Show `error.digest` as "Reference: …" when `error instanceof Error && "digest" in error`, so players can quote it to staff. `useEffect` reports to Sentry (Task 4 adds the call; in this task use `console.error(error)`).
- Create: `src/app/global-error.tsx` (`"use client"`). Renders its own `<html lang="en"><body>`, the same message with inline-safe classes (globals.css isn't guaranteed), and a `retry()` button.
- Create: `src/app/opengraph-image.tsx`. `ImageResponse` from `next/og`, 1200×630, `alt` = `` `${VENUE_NAME} – book a pickleball court` ``. Navy background `#0d131f` and lime accent (copy the hex values from `globals.css` `.crosshair` tokens). Venue name large, `VENUE_CITY` and "Book a court online" smaller. Use the default font (no font fetch). Also export `size` and `contentType = "image/png"`.
- Modify: `src/app/layout.tsx`. Add `openGraph: { siteName: VENUE_NAME, type: "website" }` and `twitter: { card: "summary_large_image" }` to the root metadata.

**Interfaces:**
- Consumes: `VENUE_NAME` and `VENUE_CITY` from `src/lib/brand.ts` (Task 2).

- [ ] **Step 1: Read** `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/not-found.md`, `error.md` (global-error section), and `01-metadata/opengraph-image.md`. Confirm the prop names and exports above. If they differ, the docs win; note the difference in the commit.
- [ ] **Step 2: Implement** the four files and the layout metadata.
- [ ] **Step 3: Build.** Run `npm run build`. Expected: success, and the route list shows `/opengraph-image`.
- [ ] **Step 4: Run** `npx tsc --noEmit -p .`, `npx eslint src/app` and `npm test`. Expected: clean, guard still green.
- [ ] **Step 5: Commit** — `feat(app): branded 404 and error pages, Open Graph link preview`

---

### Task 4: Sentry error monitoring

**Files:**
- Modify: `package.json`, `package-lock.json` (`@sentry/nextjs`)
- Create: `src/instrumentation.ts`. `register()` calls `Sentry.init` for `nodejs` and `edge` (`process.env.NEXT_RUNTIME`). Export `onRequestError = Sentry.captureRequestError`.
- Create: `src/instrumentation-client.ts`. `Sentry.init` with `NEXT_PUBLIC_SENTRY_DSN`. Export `onRouterTransitionStart = Sentry.captureRouterTransitionStart` if the installed version exports it.
- Modify: `next.config.ts`. Wrap with `withSentryConfig(nextConfig, { org: process.env.SENTRY_ORG, project: process.env.SENTRY_PROJECT, authToken: process.env.SENTRY_AUTH_TOKEN, silent: !process.env.CI })`. Source maps upload only when the token is set.
- Modify: `src/app/error.tsx` and `src/app/global-error.tsx`. Call `Sentry.captureException(error)` in the `useEffect`.

**Interfaces:**
- Server init options (both runtimes): `{ dsn: process.env.SENTRY_DSN, enabled: !!process.env.SENTRY_DSN, sendDefaultPii: false, tracesSampleRate: 0, integrations: [Sentry.captureConsoleIntegration({ levels: ["error"] })] }`. Tracing is off: this is for errors only.
- Client init: `{ dsn: process.env.NEXT_PUBLIC_SENTRY_DSN, enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN, sendDefaultPii: false, tracesSampleRate: 0 }`.

- [ ] **Step 1: Check compatibility before installing.** Run `npm view @sentry/nextjs version peerDependencies`. Expected: the peer `next` range includes 16. **If it doesn't, stop and report to the user**; don't force-install.
- [ ] **Step 2: Install** with `npm install --save-exact @sentry/nextjs@<that version>`.
- [ ] **Step 3: Read** the installed package's Next.js setup notes (`node_modules/@sentry/nextjs/README.md`) and match the file names and exports it documents for this version.
- [ ] **Step 4: Implement** the files above.
- [ ] **Step 5: Build with no DSN.** Run `npm run build` with no Sentry env vars. Expected: success, no Sentry error output except its own "no auth token, skipping source maps" notice.
- [ ] **Step 6: Run** `npx tsc --noEmit -p .`, `npx eslint src` and `npm test`. Expected: clean.
- [ ] **Step 7: Commit** — `feat(monitoring): Sentry for uncaught errors and server console.error`

---

### Task 5: Testing

**Files:** none (only fixes if a check fails, committed with the task they belong to).

- [ ] **Step 1: Full checks.** Run `npm test`, `npx tsc --noEmit -p .`, `npx eslint src` and `npm run build`. Expected: all pass.
- [ ] **Step 2: Default brand, in a browser.** Start the built app with `npm start -- -p 3200`, using a copy of `.env.local` for the Supabase reads (production; read-only page views only, no sign-in, no booking). Screenshot with Playwright at 390px and 1280px wide:
  - `/`: header still reads "Crosshair **Dinkers**".
  - `/does-not-exist`: the branded 404 page with its "Back to courts" button.
  - `/opengraph-image`: navy image with the name, lime accent.
  - `/login`: page title is "Sign In | Crosshair Dinkers".
- [ ] **Step 3: Other brand.** Rebuild with `NEXT_PUBLIC_VENUE_NAME="Dink & Drive"` and `NEXT_PUBLIC_VENUE_CITY="Cebu City"`. Check:
  - `/`: header shows "Dink &" plus an accent "Drive".
  - `/opengraph-image` shows "Dink & Drive" (not `&amp;`).
  - At 390px the header doesn't overflow.
  - Then rebuild once with `NEXT_PUBLIC_VENUE_NAME=Smashville` (one word), check the header and the 404 page, and remove both env vars.
- [ ] **Step 4: Error page.** Add a temporary `throw new Error("plan check")` to a throwaway page (`src/app/plan-check/page.tsx`, **not committed**). Build and visit it. Expected: the branded error page with a "Reference:" digest and a working "Try again". Delete the file.
- [ ] **Step 5: Sentry live check (needs the user's DSN; skip with a note if none).** With `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` set, repeat step 4 and confirm the event appears in Sentry with no email or phone in it. Then call the cron route without a secret; it should return 401, and no Sentry event is expected.
- [ ] **Step 6: Report.** List results per check, then ask the user before pushing `feat/launch-polish` to `main`.
