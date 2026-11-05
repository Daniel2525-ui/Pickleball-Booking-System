// Weekly operating hours: warning before hours drop existing bookings, whole-hour times, server checks. Local Supabase stack only.
import { test, expect } from "@playwright/test";
import { writesAllowed, requireLocalDb, sql, account, login, tomorrowManila, resetBookings, firstCourt } from "./local-db.mjs";

test.describe.configure({ mode: "serial" });

const date = tomorrowManila();
const weekday = new Date(`${date}T12:00:00+08:00`).toLocaleDateString("en-US", { weekday: "long", timeZone: "Asia/Manila" });
const closeTime = () => sql(`SELECT close_time FROM public.operating_hours WHERE day_of_week = '${weekday}'`);

test.beforeAll(() => { if (writesAllowed) resetBookings(); });
test.afterAll(() => { if (writesAllowed) resetBookings(); });
test.beforeEach(() => requireLocalDb());

test("shortening a day lists the bookings it leaves outside, and saves only when staff confirm", async ({ page }) => {
  const userId = sql(`SELECT id FROM public.profiles WHERE email = '${account("CUSTOMER").email}'`);
  sql(`INSERT INTO public.bookings (user_id, court_id, booking_date, start_time, end_time, status, total_amount, customer_name)
       VALUES ('${userId}', '${firstCourt().id}', '${date}', '20:00', '21:00', 'confirmed', 200, 'E2E Late Player')`);

  await login(page, account("ADMIN"));
  await page.goto("/admin/schedules");
  await page.getByLabel(`${weekday} closing time`).fill("20:00");
  await page.getByRole("button", { name: "Save Operating Hours" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("1 booking falls outside the new hours")).toBeVisible();
  await expect(dialog.getByText(/E2E Late Player · COURT 1 · .* 8:00 PM · 09170000001/)).toBeVisible();
  await dialog.getByRole("button", { name: "Go Back" }).click();
  expect(closeTime()).toBe("22:00:00");

  await page.getByRole("button", { name: "Save Operating Hours" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Save anyway" }).click();
  await expect(page.getByText("Operating hours updated successfully.")).toBeVisible();
  expect(closeTime()).toBe("20:00:00");
  expect(sql(`SELECT status FROM public.bookings WHERE customer_name = 'E2E Late Player'`)).toBe("confirmed");
});

test("opening and closing times must be whole hours", async ({ page }) => {
  await login(page, account("ADMIN"));
  await page.goto("/admin/schedules");
  await page.getByLabel(`${weekday} opening time`).fill("08:30");
  await expect(page.getByRole("alert").filter({ hasText: "Schedule Configuration Conflict" })).toContainText(`${weekday}: Use whole hours`);
  await expect(page.getByRole("button", { name: "Save Operating Hours" })).toBeDisabled();
});

test("the save route refuses bad hours sent directly", async ({ page }) => {
  await login(page, account("ADMIN"));
  const post = (hours) => page.request.post("/api/admin/schedules", { data: { hours } });
  const day = (fields) => ({ day_of_week: weekday, is_open: true, open_time: "08:00", close_time: "22:00", ...fields });

  for (const [hours, message] of [
    [[day({ open_time: "08:30" })], "Use whole hours"],
    [[day({ open_time: "22:00", close_time: "08:00" })], "later than opening"],
    [[day({ day_of_week: "Funday" })], "only once"],
    [[day(), day()], "only once"],
  ]) {
    const res = await post(hours);
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain(message);
  }
  expect(closeTime()).not.toBe("08:00:00");
});
