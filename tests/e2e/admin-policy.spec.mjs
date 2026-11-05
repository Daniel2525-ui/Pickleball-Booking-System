// Booking rules in Settings: the online cancellation cutoff and the no-show grace period are enforced as saved.
// Local Supabase stack only.
import { test, expect } from "@playwright/test";
import { writesAllowed, requireLocalDb, sql, account, login, resetBookings, firstCourt } from "./local-db.mjs";

test.describe.configure({ mode: "serial" });

const restore = () => sql("UPDATE public.booking_settings SET cancel_cutoff_hours = 2, no_show_grace_minutes = 15");
const hour = () => Number(sql("SELECT extract(hour FROM now() AT TIME ZONE 'Asia/Manila')"));

// A confirmed, paid booking today for the member account, starting `offset` from now (SQL interval)
function bookToday(name, offset) {
  const userId = sql(`SELECT id FROM public.profiles WHERE email = '${account("CUSTOMER").email}'`);
  const local = "(now() AT TIME ZONE 'Asia/Manila')";
  const id = sql(`INSERT INTO public.bookings (user_id, court_id, booking_date, start_time, end_time, status, total_amount, customer_name)
    VALUES ('${userId}', '${firstCourt().id}', ${local}::date, date_trunc('minute', ${local} + interval '${offset}')::time,
            date_trunc('minute', ${local} + interval '${offset}' + interval '1 hour')::time, 'confirmed', 200, '${name}') RETURNING id`).split(/\s+/)[0];
  sql(`INSERT INTO public.payments (booking_id, amount, currency, status, payment_method, paid_at) VALUES ('${id}', 200, 'php', 'paid', 'cash', now())`);
  return id;
}

test.beforeAll(() => { if (writesAllowed) { resetBookings(); restore(); } });
test.afterAll(() => { if (writesAllowed) { resetBookings(); restore(); } });
test.beforeEach(() => requireLocalDb());

test("staff change the cancellation cutoff, and players are held to it", async ({ page }) => {
  test.skip(hour() < 6 || hour() >= 19, "needs a booking 3 hours from now within the day");
  await login(page, account("ADMIN"));
  await page.goto("/admin/settings");
  await page.getByLabel("Online cancellation closes (hours before start)").fill("4");
  await page.getByRole("button", { name: "Save booking rules" }).click();
  await expect(page.getByText("Booking rules saved.")).toBeVisible();
  expect(sql("SELECT cancel_cutoff_hours FROM public.booking_settings")).toBe("4");
  await expect(page.getByText("Online cancellation closes: 2 → 4 hours before start").first()).toBeVisible();

  // A booking 3 hours away is now inside the cutoff: the cancel route refuses it, naming the new rule
  const id = bookToday("E2E Inside Cutoff", "3 hours");
  await page.context().clearCookies();
  await login(page, account("CUSTOMER"));
  const res = await page.request.post("/api/bookings/cancel", { data: { bookingId: id } });
  expect(res.status()).toBe(409);
  expect((await res.json()).error).toContain("up to 4 hours before the start time");
  expect(sql(`SELECT status FROM public.bookings WHERE id = '${id}'`)).toBe("confirmed");

  await page.goto("/");
  await expect(page.getByText("4 hrs", { exact: true })).toBeVisible();
});

test("the no-show grace period follows the saved value", async ({ page }) => {
  test.skip(hour() < 7 || hour() >= 21, "needs a booking that started a few minutes ago within the day");
  const id = bookToday("E2E Late Starter", "-5 minutes");
  await login(page, account("ADMIN"));

  sql("UPDATE public.booking_settings SET no_show_grace_minutes = 120");
  let res = await page.request.post("/api/admin/bookings/status", { data: { bookingId: id, status: "no_show" } });
  expect(res.status()).toBe(409);
  expect((await res.json()).error).toMatch(/grace period has not elapsed/);

  sql("UPDATE public.booking_settings SET no_show_grace_minutes = 0");
  res = await page.request.post("/api/admin/bookings/status", { data: { bookingId: id, status: "no_show" } });
  expect(res.status()).toBe(200);
  expect(sql(`SELECT status FROM public.bookings WHERE id = '${id}'`)).toBe("no_show");
});

test("impossible values are refused on the page", async ({ page }) => {
  await login(page, account("ADMIN"));
  await page.goto("/admin/settings");
  await page.getByLabel("No-show grace period (minutes after start)").fill("500");
  await page.getByRole("button", { name: "Save booking rules" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "between 0 and 120 whole minutes" })).toBeVisible();
});

test("leaving with unsaved booking rules asks first", async ({ page }) => {
  await login(page, account("ADMIN"));
  await page.goto("/admin/settings");
  await page.getByLabel("Online cancellation closes (hours before start)").fill("5");
  const dialog = page.waitForEvent("dialog");
  await page.close({ runBeforeUnload: true });
  const d = await dialog;
  expect(d.type()).toBe("beforeunload");
  await d.dismiss();
});
