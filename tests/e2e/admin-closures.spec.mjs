// One-off closed dates: staff close a day, and nobody can book it, walk-ins included. Local Supabase stack only.
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { writesAllowed, requireLocalDb, sql, account, login, tomorrowManila, resetBookings, firstCourt, openAllBookings, pickDay, localSupabase } from "./local-db.mjs";

test.describe.configure({ mode: "serial" });

let court;
const date = tomorrowManila();
const shortDate = new Date(`${date}T12:00:00+08:00`).toLocaleDateString("en-US", { timeZone: "Asia/Manila", weekday: "short", month: "short", day: "numeric" });

const wipe = () => {
  resetBookings();
  sql("DELETE FROM public.venue_closures");
};

test.beforeAll(() => {
  if (!writesAllowed) return;
  wipe();
  court = firstCourt();
});
test.afterAll(() => { if (writesAllowed) wipe(); });
test.beforeEach(() => requireLocalDb());

test("staff close a date and see the booking already on it", async ({ page }) => {
  const userId = sql(`SELECT id FROM public.profiles WHERE email = '${account("CUSTOMER").email}'`);
  sql(`INSERT INTO public.bookings (user_id, court_id, booking_date, start_time, end_time, status, total_amount, customer_name)
       VALUES ('${userId}', '${court.id}', '${date}', '15:00', '16:00', 'confirmed', 200, 'E2E Booked Before')`);

  await login(page, account("ADMIN"));
  await page.goto("/admin/schedules");
  await page.locator("#closure-date").fill(date); // the court blocks card has a "Date" field too
  const warning = page.getByRole("status").filter({ hasText: "already on" });
  await expect(warning.getByText(`1 booking is already on ${shortDate}`)).toBeVisible();
  await expect(warning.getByText(/E2E Booked Before/)).toBeVisible();
  await expect(warning.getByRole("link", { name: "09170000001" })).toBeVisible();

  await page.locator("#closure-reason").fill("E2E Holiday");
  await page.getByRole("button", { name: "Close this date" }).click();
  await expect(page.getByText(`Closed on ${shortDate}. Customers can no longer book it.`)).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "E2E Holiday" })).toContainText(shortDate);
  expect(sql(`SELECT reason FROM public.venue_closures WHERE closed_on = '${date}'`)).toBe("E2E Holiday");
  // Closing the date left the existing booking alone
  expect(sql(`SELECT status FROM public.bookings WHERE customer_name = 'E2E Booked Before'`)).toBe("confirmed");
});

test("customers see the date closed and cannot book it, even through checkout", async ({ page }) => {
  await login(page, account("CUSTOMER"));
  await page.goto("/book");
  await pickDay(page, 1);
  await expect(page.getByText("The venue is closed on this date for E2E Holiday.")).toBeVisible();

  // A page opened before the closure would still offer slots: the database refuses the hold
  const res = await page.request.post("/api/stripe/checkout", {
    data: { player_count: 2, booking_date: date, lines: [{ court_id: court.id, start_time: "10:00", end_time: "11:00" }] },
  });
  expect(res.status()).toBe(400);
  expect((await res.json()).error).toBe("The venue is closed on this date.");
  expect(sql(`SELECT count(*) FROM public.bookings WHERE booking_date = '${date}' AND start_time = '10:00'`)).toBe("0");
});

test("staff can't record a walk-in on a closed date either", async ({ page }) => {
  await login(page, account("ADMIN"));
  await openAllBookings(page);
  await page.getByRole("button", { name: "New Reservation" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "New Walk-In" }).click();
  await dialog.getByLabel("Full Name").fill("E2E Closed Day Walk-in");
  await dialog.getByLabel("Assigned Court").click();
  await page.getByRole("option", { name: court.name }).click();
  await dialog.getByLabel("Reservation Date").fill(date);
  await expect(dialog.getByText("No open slots for this court on this date.")).toBeVisible();
  await expect(dialog.getByLabel("Start Time")).toBeDisabled();

  // The database refuses it too, even when called directly as staff
  const { url, anonKey } = localSupabase();
  const staff = createClient(url, anonKey, { auth: { persistSession: false } });
  await staff.auth.signInWithPassword(account("ADMIN"));
  const amount = Number(sql("SELECT base_hourly_rate FROM public.booking_settings"));
  const { error } = await staff.rpc("create_walk_in_booking", {
    p_court_id: court.id, p_customer_name: "E2E Closed Day Walk-in", p_booking_date: date, p_start_time: "18:00", p_end_time: "19:00",
    p_amount: amount, p_customer_id: null, p_user_id: sql(`SELECT id FROM public.profiles WHERE email = '${account("ADMIN").email}'`),
    p_payment_method: "cash", p_payment_reference: null,
  });
  expect(error?.message).toContain("VENUE_CLOSED");
  expect(sql(`SELECT count(*) FROM public.bookings WHERE customer_name = 'E2E Closed Day Walk-in'`)).toBe("0");
});

test("reopening the date lets customers book it again", async ({ page }) => {
  await login(page, account("ADMIN"));
  await page.goto("/admin/schedules");
  await page.getByRole("button", { name: `Reopen ${shortDate}` }).click();
  await expect(page.getByText(`${shortDate} is open for bookings again.`)).toBeVisible();
  await expect(page.getByText("No upcoming closed dates.")).toBeVisible();
  expect(sql(`SELECT count(*) FROM public.venue_closures`)).toBe("0");

  await page.context().clearCookies();
  await login(page, account("CUSTOMER"));
  await page.goto("/book");
  await pickDay(page, 1);
  await expect(page.getByText(/The venue is closed on this date/)).toHaveCount(0);
});
