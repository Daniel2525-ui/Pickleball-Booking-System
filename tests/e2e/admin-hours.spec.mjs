// Weekly operating hours: warning before hours drop existing bookings, whole-hour times, server checks. Local Supabase stack only.
import { test, expect } from "@playwright/test";
import { writesAllowed, requireLocalDb, requireQrPh, sql, account, login, tomorrowManila, resetBookings, firstCourt } from "./local-db.mjs";

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
    [[day({ close_time: "05:00" })], "after midnight up to 4:00 AM"],
    [[day({ open_time: "03:00" })], "earlier than 4:00 AM"],
    [[day({ day_of_week: "Funday" })], "only once"],
    [[day(), day()], "only once"],
  ]) {
    const res = await post(hours);
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain(message);
  }
  expect(closeTime()).not.toBe("08:00:00");
});

test("a day can close after midnight", async ({ page }) => {
  resetBookings();
  await login(page, account("ADMIN"));
  await page.goto("/admin/schedules");
  await page.getByLabel(`${weekday} opening time`).fill("22:00");
  await page.getByLabel(`${weekday} closing time`).fill("02:00");
  await expect(page.getByText(`Open 4 hours · until 2 AM`, { exact: false }).first()).toBeVisible();
  await page.getByRole("button", { name: "Save Operating Hours" }).click();
  await expect(page.getByText("Operating hours updated successfully.")).toBeVisible();
  expect(closeTime()).toBe("02:00:00");
});

test("checkout holds late-night hours on their real dates and never across closing", async ({ page }) => {
  requireQrPh();
  const nextDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(Date.now() + 2 * 86_400_000));
  const court = firstCourt();
  await login(page, account("CUSTOMER"));
  const checkout = (booking_date, start_time, end_time) =>
    page.request.post("/api/stripe/checkout", { data: { player_count: 2, booking_date, lines: [{ court_id: court.id, start_time, end_time }] } });

  // Tomorrow is open 10 PM to 2 AM: nothing before 10 PM, nothing past 2 AM, and 1 AM never joins the next morning
  for (const [d, start, end] of [[date, "21:00", "22:00"], [nextDate, "01:00", "03:00"], [nextDate, "01:00", "07:00"]]) {
    const res = await checkout(d, start, end);
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain("outside venue operating hours");
  }

  const res = await checkout(date, "23:00", "24:00");
  expect(res.status()).toBe(200);
  expect(sql(`SELECT end_time || ' ' || status FROM public.bookings WHERE booking_date = '${date}' AND start_time = '23:00'`)).toBe("24:00:00 pending");
});

test("the booking grid lists a day's late hours at its bottom under their own heading, never on the next date", async ({ page }) => {
  resetBookings();
  const tomorrowName = new Date(Date.now() + 86_400_000).toLocaleDateString("en-US", { weekday: "long", timeZone: "Asia/Manila" });
  sql(`UPDATE public.operating_hours SET close_time = '02:00' WHERE day_of_week = '${tomorrowName}'`);
  const court = firstCourt();
  await page.goto("/#booking");
  await page.getByRole("button", { name: /Tmrw/ }).click();

  await expect(page.getByText("After midnight", { exact: true }).filter({ visible: true })).toBeVisible();
  await page.getByRole("button", { name: `Select ${court.name} at 1:00 AM - 2:00 AM` }).filter({ visible: true }).click();
  await page.getByRole("button", { name: `Select ${court.name} at 6:00 AM - 7:00 AM` }).filter({ visible: true }).click();
  // 6-7 AM opens the day and 1-2 AM ends it: two separate bookings
  const lines = page.getByRole("region", { name: "Your selection" }).getByRole("group", { name: new RegExp(`^${court.name} .+ selection line$`) });
  await expect(lines).toHaveCount(2);

  // The next date starts at its own opening: the 1-2 AM hour belongs to the night before
  await page.getByRole("button", { name: "Next day" }).click();
  await expect(page.getByRole("button", { name: `Select ${court.name} at 6:00 AM - 7:00 AM` }).filter({ visible: true })).toBeVisible();
  await expect(page.getByRole("button", { name: `Select ${court.name} at 1:00 AM - 2:00 AM` })).toHaveCount(0);
});
