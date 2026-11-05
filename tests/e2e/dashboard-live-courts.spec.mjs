// The dashboard's live court card: who is on each court, time left, payment and who is next. Local Supabase stack only.
import { test, expect } from "@playwright/test";
import { writesAllowed, requireLocalDb, sql, account, login, resetBookings, firstCourt } from "./local-db.mjs";

test.describe.configure({ mode: "serial" });

const today = () => sql("SELECT (now() AT TIME ZONE 'Asia/Manila')::date::text");
// The browser's clock is set to 7:35 PM today; earlier than real time so sign-in tokens never look expired
const sevenThirtyFive = () => new Date(`${today()}T19:35:00+08:00`);

test.beforeAll(() => {
  if (!writesAllowed) return;
  resetBookings();
  const court = firstCourt();
  const user = sql(`SELECT id FROM public.profiles WHERE email = '${account("CUSTOMER").email}'`);
  // On court now, not paid yet
  const now = sql(`INSERT INTO public.bookings (user_id, court_id, booking_date, start_time, end_time, status, total_amount, customer_name)
    VALUES ('${user}', '${court.id}', '${today()}', '19:00', '20:00', 'confirmed', 400, 'E2E Live Player') RETURNING id`).split(/\s+/)[0];
  sql(`INSERT INTO public.payments (booking_id, amount, currency, status) VALUES ('${now}', 400, 'php', 'pending')`);
  // Next on the same court
  const next = sql(`INSERT INTO public.bookings (user_id, court_id, booking_date, start_time, end_time, status, total_amount, customer_name)
    VALUES ('${user}', '${court.id}', '${today()}', '20:00', '21:00', 'confirmed', 200, 'E2E Live Next') RETURNING id`).split(/\s+/)[0];
  sql(`INSERT INTO public.payments (booking_id, amount, currency, status, payment_method, paid_at) VALUES ('${next}', 200, 'php', 'paid', 'gcash', now())`);
  // Paid by GCash, staff haven't checked the screenshot yet: still holds its court
  const second = sql(`SELECT id FROM public.courts WHERE name > '${court.name}' ORDER BY name LIMIT 1`);
  const waiting = sql(`INSERT INTO public.bookings (user_id, court_id, booking_date, start_time, end_time, status, total_amount, customer_name, hold_expires_at)
    VALUES ('${user}', '${second}', '${today()}', '19:00', '20:00', 'pending', 400, 'E2E GCash Waiting', 'infinity') RETURNING id`).split(/\s+/)[0];
  sql(`INSERT INTO public.payments (booking_id, amount, currency, status, payment_method, payment_reference, gcash_submitted_at) VALUES ('${waiting}', 400, 'php', 'pending', 'gcash', 'LIVE123', now())`);
});
test.afterAll(() => { if (writesAllowed) resetBookings(); });
test.beforeEach(() => requireLocalDb());

test("staff see who is on each court, how long they have, whether they paid, and who is next", async ({ page }) => {
  const court = firstCourt();
  await login(page, account("ADMIN"));
  await page.clock.setFixedTime(sevenThirtyFive());
  await page.goto("/admin/dashboard");

  const card = page.getByRole("region", { name: "Live Court Occupancy" });
  const tile = card.getByRole("group", { name: court.name, exact: true });
  await expect(tile.getByText("In play")).toBeVisible();
  await expect(tile.getByText("E2E Live Player")).toBeVisible();
  await expect(tile.getByText("7:00 PM – 8:00 PM")).toBeVisible();
  await expect(tile.getByText("25 min left")).toBeVisible();
  await expect(tile.getByText("Unpaid · collect ₱400")).toBeVisible();
  await expect(tile.getByText(/Next:\s*E2E Live Next at 8:00 PM/)).toBeVisible();
  await expect(card.getByText("Live · 7:35 PM")).toBeVisible();

  // A player whose GCash payment hasn't been checked is on court, not "free"
  const waiting = card.getByRole("group").filter({ hasText: "E2E GCash Waiting" });
  await expect(waiting.getByText("In play")).toBeVisible();
  await expect(waiting.getByText("GCash · waiting for your check")).toBeVisible();

  // The remaining courts are free, with nothing else booked today
  const other = card.getByRole("group").filter({ hasNotText: court.name }).filter({ hasNotText: "E2E GCash Waiting" }).first();
  await expect(other.getByText("Free", { exact: true })).toBeVisible();
  await expect(other.getByText("No more bookings today")).toBeVisible();
});

test("front desk sees the same card", async ({ page }) => {
  sql(`UPDATE public.profiles SET role = 'admin', is_owner = false WHERE email = '${account("CUSTOMER2").email}'`);
  try {
    await login(page, account("CUSTOMER2"));
    await page.clock.setFixedTime(sevenThirtyFive());
    await page.goto("/admin/dashboard");
    await expect(page.getByRole("region", { name: "Live Court Occupancy" }).getByText("E2E Live Player")).toBeVisible();
  } finally {
    sql(`UPDATE public.profiles SET role = 'customer', is_owner = false WHERE email = '${account("CUSTOMER2").email}'`);
  }
});

test("if the courts can't load, the card says so instead of loading forever", async ({ page }) => {
  await login(page, account("ADMIN"));
  // Only the live card asks for open-play sessions with capacity: fail that request
  await page.route(/\/rest\/v1\/open_play_sessions\?select=id%2Ccapacity/, (route) => route.abort());
  await page.goto("/admin/dashboard");
  await expect(page.getByRole("region", { name: "Live Court Occupancy" }).getByRole("alert")).toHaveText("Couldn't load the courts. Trying again every minute.");
});
