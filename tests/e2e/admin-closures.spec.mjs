// One-off closed dates: staff close a day, customers can't book it, staff still can. Local Supabase stack only.
import { test, expect } from "@playwright/test";
import { writesAllowed, requireLocalDb, sql, account, login, tomorrowManila, resetBookings, firstCourt, openAllBookings } from "./local-db.mjs";

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
  await page.getByLabel("Date", { exact: true }).fill(date);
  const warning = page.getByRole("status").filter({ hasText: "already on" });
  await expect(warning.getByText(`1 booking is already on ${shortDate}`)).toBeVisible();
  await expect(warning.getByText(/E2E Booked Before/)).toBeVisible();
  await expect(warning.getByRole("link", { name: "09170000001" })).toBeVisible();

  await page.getByLabel("Reason (optional)").fill("E2E Holiday");
  await page.getByRole("button", { name: "Close this date" }).click();
  await expect(page.getByText(`Closed on ${shortDate}. Customers can no longer book it.`)).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "E2E Holiday" })).toContainText(shortDate);
  expect(sql(`SELECT reason FROM public.venue_closures WHERE closed_on = '${date}'`)).toBe("E2E Holiday");
  // Closing the date left the existing booking alone
  expect(sql(`SELECT status FROM public.bookings WHERE customer_name = 'E2E Booked Before'`)).toBe("confirmed");
});

test("customers see the date closed and cannot book it, even through checkout", async ({ page }) => {
  await login(page, account("CUSTOMER"));
  await page.setViewportSize({ width: 412, height: 915 }); // the day strip with "Tmrw" is the phone layout
  await page.goto("/#booking");
  await page.getByRole("button", { name: "See the full board" }).click();
  await page.getByRole("button", { name: /Tmrw/ }).click();
  await expect(page.getByText("The venue is closed on this date (E2E Holiday). Please select another date.")).toBeVisible();

  // A page opened before the closure would still offer slots: the database refuses the hold
  const res = await page.request.post("/api/stripe/checkout", {
    data: { booking_date: date, lines: [{ court_id: court.id, start_time: "10:00", end_time: "11:00" }] },
  });
  expect(res.status()).toBe(400);
  expect((await res.json()).error).toBe("The venue is closed on this date.");
  expect(sql(`SELECT count(*) FROM public.bookings WHERE booking_date = '${date}' AND start_time = '10:00'`)).toBe("0");
});

test("staff can still record a walk-in on a closed date", async ({ page }) => {
  await login(page, account("ADMIN"));
  await openAllBookings(page);
  await page.getByRole("button", { name: "New Reservation" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "New Walk-In" }).click();
  await dialog.getByLabel("Full Name").fill("E2E Private Event");
  await dialog.getByLabel("Assigned Court").click();
  await page.getByRole("option", { name: court.name }).click();
  await dialog.getByLabel("Reservation Date").fill(date);
  await dialog.getByLabel("Start Time").fill("18:00");
  await dialog.getByLabel("End Time").fill("19:00");
  await dialog.getByRole("button", { name: "Cash (Paid)", exact: true }).click();
  await dialog.getByRole("button", { name: "Record Reservation" }).click();
  await expect(page.getByText("Reservation recorded successfully!")).toBeVisible();
  expect(sql(`SELECT status FROM public.bookings WHERE customer_name = 'E2E Private Event'`)).toBe("confirmed");
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
  await page.setViewportSize({ width: 412, height: 915 }); // the day strip with "Tmrw" is the phone layout
  await page.goto("/#booking");
  await page.getByRole("button", { name: "See the full board" }).click();
  await page.getByRole("button", { name: /Tmrw/ }).click();
  await expect(page.getByText(/The venue is closed on this date/)).toHaveCount(0);
});
