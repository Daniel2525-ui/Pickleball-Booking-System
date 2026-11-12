# Guest checkout, discount codes and number of players — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (chosen: inline). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Guests pay with a details form (account optional), every checkout carries a number of players, and a discount code can be applied, with admin pages for codes and the players limit.

**Architecture:** Guests get a Supabase anonymous session, so the existing ownership checks carry them; the checkout route stores their details in a guest profile. Player count and discount code travel with the checkout to `hold_court_basket`, which validates both and writes the discounted amounts to bookings and payments before QR Ph is opened.

**Tech Stack:** Next.js 16 App Router, Supabase Postgres/Auth (anonymous sign-ins), node:test, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-12-guest-checkout-discounts-players-design.md`

## Global Constraints

- Migration files are tested on the local stack only; production apply needs the user's OK; each ships a rollback in `supabase/`.
- Production also needs "Allow anonymous sign-ins" switched on in the Supabase dashboard (user action).
- Write e2e only on :3200 against local Supabase (`scripts/e2e-app.sh`); `.env.local` is production.
- Never read or print secrets. Preserve CRLF line endings.
- Discounted amounts are rounded to centavos; a checkout's QR Ph charge must equal the sum of its payments rows.

## Review Focus

1. Two checkouts racing for a code's last use: exactly one gets it (row lock). → Task 1 SQL check runs the second hold in the same transaction after the first and expects `DISCOUNT_INVALID`.
2. A guest who later registers with the same browser keeps their bookings and stops being a guest. → Task 1 SQL check on `handle_new_user`; Task 4 e2e.
3. A fixed code larger than the first line's price spills into the next line, and never below zero per line. → Task 2 unit test.
4. The 7-day cleanup does not delete a guest who has a profile. → Task 1 SQL check.
5. A signed-in (non-guest) player is never asked for name/phone/email and their profile is never overwritten. → Task 3 route test via validation helper + Task 4 e2e.

---

### Task 1: Database

**Files:** Create `supabase/migrations/20261113020000_guest_checkout_discounts_players.sql`, `supabase/rollback_guest_checkout_discounts_players.sql`, `tests/integration/guest-discounts-players.sql`.

- `profiles.is_guest boolean not null default false`.
- `handle_new_user`: `ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, is_guest = false, full_name = coalesce(nullif(EXCLUDED.full_name,''), profiles.full_name), phone = coalesce(nullif(EXCLUDED.phone,''), profiles.phone)`.
- `booking_settings.max_players_per_court integer not null default 8 check (between 1 and 30)`; `save_pricing_settings` untouched (settings page writes it through its own route, see Task 5).
- `bookings.player_count integer check (player_count > 0)`, `bookings.discount_code_id uuid references discount_codes on delete restrict`, `bookings.discount_amount numeric(10,2) not null default 0 check (>= 0)`.
- `discount_codes` table per spec, RLS: admin all, nobody else.
- `discount_code_uses(p_code_id)`: count of distinct baskets using it (statuses per spec).
- `check_discount_code(p_code text, p_subtotal numeric) returns jsonb` (security definer, `GRANT EXECUTE` to anon, authenticated).
- `hold_court_basket(p_booking_date, p_lines, p_hold_expires_at, p_player_count integer default null, p_discount_code text default null)`: drop the 3-arg version and create the 5-arg one (same body + player and discount steps). Player count required when called by a customer (`auth.uid()` not null and not service role)? No: the route always sends it; the function requires `p_player_count` between 1 and max × distinct courts when given, and stores it.
- Discount application after the loop, per spec; items/total returned discounted.
- [ ] Write the SQL self-check (rolled back) covering: percent and fixed amounts on bookings and payments; inactive / not started / ended / used up refusals; last use taken once; whole-booking discount refused; player count bounds and storage; guest profile survives `delete_stale_unconfirmed_users`; `handle_new_user` converts a guest profile.
- [ ] Run it, expect failure; write migration + rollback; apply locally; rerun all SQL checks (`late-night-basket`, `after-midnight-hours`, `book-running-hour`, new one) → pass; rollback → old checks pass; re-apply.
- [ ] Commit `feat(db): guest profiles, player count and discount codes at checkout`.

### Task 2: Pure helpers

**Files:** Create `src/lib/services/bookings/guestDetails.ts`, `src/lib/services/pricing/discounts.ts`; tests `tests/guest-checkout.test.mjs`.

- `parseGuestDetails(input: unknown): { ok: true; value: { full_name; phone; email } } | { ok: false; error }` (phone normalised to `09XXXXXXXXX`).
- `maxPlayers(perCourt: number, courtCount: number)` and `checkPlayerCount(n: unknown, max: number): string | null`.
- `applyDiscount(amounts: number[], code: { kind; value }): number[]` mirroring the SQL (for the dialog preview and the unit test that pins the SQL rule).
- `normaliseCode(s: string): string | null` (trim, upper, `^[A-Z0-9-]{3,20}$`).
- [ ] Tests first (RED), implement, `npm test` GREEN, commit.

### Task 3: Checkout API, preview API

**Files:** `src/app/api/stripe/checkout/route.ts`, create `src/app/api/discount-codes/check/route.ts`, `src/lib/services/payments/createCheckoutSession.service.ts`.

- Route: anonymous caller → rate limit `guest-checkout:ip` 10/h, `parseGuestDetails`, upsert profile with service role (`is_guest true`). Non-anonymous caller: ignore any `guest` field.
- Body adds `player_count` (required) and `discount_code` (optional) → `checkPlayerCount` against `booking_settings.max_players_per_court` × distinct courts → RPC args `p_player_count`, `p_discount_code`.
- Map `DISCOUNT_INVALID: <reason>` and `INVALID_PLAYER_COUNT` to 400 with the reason.
- Preview route: POST `{ code, subtotal }` → rate limit per IP 30/h → `check_discount_code` via the caller's client → `{ valid, reason, discount }`.
- `createCheckoutSession({ bookingDate, lines, playerCount, discountCode?, guest? })`.
- [ ] Unit tests for the new helpers already cover validation; `npx tsc`, lint, `npm test`; commit.

### Task 4: Customer UI

**Files:** `src/components/customers/booking-modal.tsx`, `booking-container.tsx`, `src/app/(auth)/register` page + `src/app/api/auth/register/route.ts`, `src/components/customers/public-header.tsx` (account menu for guests), `src/app/(customer)/book/success/page.tsx`.

- Dialog: details section for guests (no session or anonymous): name, phone, email with inline errors; "Have an account? Sign in" link; players stepper/number (1..max); discount code + Apply showing the amount off and new total; Pay button names the discounted total.
- Signed-in: players + discount only.
- `startCheckout` always opens the dialog (login prompt dialog removed); `confirmBooking` signs in anonymously first when there is no session.
- Register: an anonymous session converts with `updateUser` (server route reads the session; on success the client refreshes).
- Header: anonymous session shows "Guest" with "Create an account" and "My bookings".
- Success page: guests see "Create an account to keep track of your bookings".
- [ ] e2e `tests/e2e/guest-checkout.spec.mjs`: guest fills details, holds are made (payment branch skipped without Xendit), bad code shows reason, player count over max refused; guest converts via register and still sees the booking in My Bookings.
- [ ] Commit.

### Task 5: Admin

**Files:** create `src/app/(admin)/admin/discounts/page.tsx`, `src/components/admin/discounts/*`, `src/app/api/admin/discounts/route.ts`; `src/components/admin/app-sidebar.tsx`; `src/proxy.ts` (owner-only like pricing); settings policy card + its route for `max_players_per_court`; bookings table, details sheet, dashboard today's schedule show players and guest/discount.
- [ ] e2e `tests/e2e/admin-discounts.spec.mjs`: owner creates a code, switches it off, sees uses; sets max players.
- [ ] Commit.

### Task 6: Verify, review, ship

- [ ] Full unit suite, all SQL checks, related e2e; fresh-context whole-branch review; fix Critical/Important; commit, push, merge to demo/xendit (user asked); production migration only with the user's OK, plus the anonymous sign-ins toggle.
