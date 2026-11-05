// Admin lists show the answer for the current filter, and say so when loading fails. Local Supabase stack only.
import { test, expect } from "@playwright/test";
import { writesAllowed, requireLocalDb, sql, account, login, tomorrowManila, resetBookings, firstCourt } from "./local-db.mjs";

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  if (!writesAllowed) return;
  resetBookings();
  const userId = sql(`SELECT id FROM public.profiles WHERE email = '${account("CUSTOMER").email}'`);
  sql(`INSERT INTO public.bookings (user_id, court_id, booking_date, start_time, end_time, status, total_amount, customer_name)
       VALUES ('${userId}', '${firstCourt().id}', '${tomorrowManila()}', '10:00', '11:00', 'confirmed', 200, 'E2E Tomorrow Row')`);
});
test.afterAll(() => { if (writesAllowed) resetBookings(); });
test.beforeEach(() => requireLocalDb());

test("a slow answer for an older filter does not replace the newer list", async ({ page }) => {
  await login(page, account("ADMIN"));
  // Hold back the first "today only" request, so it answers after the "all dates" one
  let held = false;
  await page.route("**/rest/v1/bookings?*booking_date=eq.*", async (route) => {
    if (held) return route.continue();
    held = true;
    await new Promise((r) => setTimeout(r, 2500));
    await route.continue();
  });
  await page.goto("/admin/bookings");
  await page.getByRole("button", { name: "Clear date filter" }).click();
  const row = page.getByRole("row").filter({ hasText: "E2E Tomorrow Row" });
  await expect(row).toHaveCount(1);
  await page.waitForTimeout(3500); // the held "today" answer has arrived by now
  await expect(row).toHaveCount(1);
});

test("a failed load says so instead of showing an empty list", async ({ page }) => {
  await login(page, account("ADMIN"));
  await page.route("**/rest/v1/bookings?*", (route) =>
    route.request().method() === "GET" ? route.fulfill({ status: 500, contentType: "application/json", body: '{"message":"boom"}' }) : route.continue());
  await page.goto("/admin/bookings");
  await expect(page.getByText("Could not load reservations. Refresh the page to try again.")).toBeVisible();

  await page.route("**/rest/v1/payments?*", (route) =>
    route.request().method() === "GET" ? route.fulfill({ status: 500, contentType: "application/json", body: '{"message":"boom"}' }) : route.continue());
  await page.goto("/admin/payments");
  await expect(page.getByText("Could not load payments. Refresh the page to try again.")).toBeVisible();
});
