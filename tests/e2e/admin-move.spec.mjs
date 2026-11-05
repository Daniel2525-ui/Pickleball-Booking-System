// Moving a booking to another court or time: same length, same price, slot must be free. Local Supabase stack only.
import { test, expect } from "@playwright/test";
import { writesAllowed, requireLocalDb, sql, account, login, tomorrowManila, resetBookings, openAllBookings } from "./local-db.mjs";

test.describe.configure({ mode: "serial" });

const date = tomorrowManila();
const weekday = new Date(`${date}T12:00:00+08:00`).toLocaleDateString("en-US", { weekday: "long", timeZone: "Asia/Manila" });
const courtId = (name) => sql(`SELECT id FROM public.courts WHERE name = '${name}'`);
let moverId;

// A confirmed, paid booking for the member account
function book(name, court, start, end, status = "confirmed") {
  const userId = sql(`SELECT id FROM public.profiles WHERE email = '${account("CUSTOMER").email}'`);
  const id = sql(`INSERT INTO public.bookings (user_id, court_id, booking_date, start_time, end_time, status, total_amount, customer_name)
    VALUES ('${userId}', '${courtId(court)}', '${date}', '${start}', '${end}', '${status}', 200, '${name}') RETURNING id`).split(/\s+/)[0];
  sql(`INSERT INTO public.payments (booking_id, amount, currency, status, payment_method, paid_at) VALUES ('${id}', 200, 'php', 'paid', 'cash', now())`);
  return id;
}

test.beforeAll(() => {
  if (!writesAllowed) return;
  resetBookings();
  moverId = book("E2E Mover", "COURT 1", "10:00", "11:00");
  book("E2E Blocker", "COURT 3", "16:00", "17:00");
  // 18:00-20:00 tomorrow costs more, so a move there changes the price
  sql(`INSERT INTO public.peak_rates (label, days, start_time, end_time, hourly_rate) VALUES ('E2E Peak', ARRAY['${weekday}'], '18:00', '20:00', 300)`);
});
test.afterAll(() => { if (writesAllowed) resetBookings(); });
test.beforeEach(() => requireLocalDb());

const where = () => sql(`SELECT c.name || '|' || b.booking_date || '|' || b.start_time || '|' || b.end_time FROM public.bookings b JOIN public.courts c ON c.id = b.court_id WHERE b.id = '${moverId}'`);

async function openMove(page) {
  await openAllBookings(page);
  await page.getByRole("row").filter({ hasText: "E2E Mover" }).getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("menuitem", { name: "Move Booking" }).click();
  return page.getByRole("dialog");
}

async function moveTo(dialog, page, { court, start }) {
  if (court) {
    await dialog.getByLabel("Court").click();
    await page.getByRole("option", { name: court }).click();
  }
  if (start) await dialog.getByLabel("Start time").fill(start);
  await dialog.getByRole("button", { name: "Move Booking" }).click();
}

test("staff move a booking to another court, then another time; the payment is untouched", async ({ page }) => {
  await login(page, account("ADMIN"));
  let dialog = await openMove(page);
  await moveTo(dialog, page, { court: "COURT 2" });
  await expect(page.getByText(/Moved to COURT 2 · .* · 10:00 AM–11:00 AM/)).toBeVisible();
  expect(where()).toBe(`COURT 2|${date}|10:00:00|11:00:00`);
  await expect(page.getByRole("row").filter({ hasText: "E2E Mover" })).toContainText("COURT 2");

  dialog = await openMove(page);
  await moveTo(dialog, page, { start: "14:00" });
  await expect(dialog.getByText("Ends at 2:00 PM")).toHaveCount(0); // dialog closed after the move
  expect(where()).toBe(`COURT 2|${date}|14:00:00|15:00:00`);
  expect(sql(`SELECT count(*) || '|' || min(status) || '|' || min(amount) FROM public.payments WHERE booking_id = '${moverId}'`)).toBe("1|paid|200.00");
});

test("a move into a taken slot or a pricier slot is refused in plain words", async ({ page }) => {
  await login(page, account("ADMIN"));
  const dialog = await openMove(page);
  await moveTo(dialog, page, { court: "COURT 3", start: "16:00" });
  await expect(dialog.getByRole("alert")).toHaveText("That court is already booked at that time.");

  await dialog.getByLabel("Start time").fill("18:00");
  await expect(dialog.getByText("Ends at 7:00 PM (same 1-hour length).")).toBeVisible();
  await dialog.getByRole("button", { name: "Move Booking" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("This move changes the price from ₱200 to ₱300. Cancel and rebook instead.");
  expect(where()).toBe(`COURT 2|${date}|14:00:00|15:00:00`);
});

test("a checked-in booking can't be moved", async ({ page }) => {
  const id = book("E2E Checked In", "COURT 4", "09:00", "10:00", "checked_in");
  await login(page, account("ADMIN"));
  await openAllBookings(page);
  await page.getByRole("row").filter({ hasText: "E2E Checked In" }).getByRole("button", { name: "Open menu" }).click();
  await expect(page.getByRole("menuitem", { name: "Move Booking" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // The database refuses it even when asked directly
  const res = await page.request.post("/api/admin/bookings/move", { data: { bookingId: id, courtId: courtId("COURT 4"), date, startTime: "12:00" } });
  expect(res.status()).toBe(409);
  expect((await res.json()).error).toBe("Only confirmed bookings that have not started can be moved.");
});

test("customers can't move bookings", async ({ page }) => {
  await login(page, account("CUSTOMER"));
  const res = await page.request.post("/api/admin/bookings/move", { data: { bookingId: moverId, courtId: courtId("COURT 1"), date, startTime: "12:00" } });
  expect([401, 403]).toContain(res.status());
  expect(where()).toBe(`COURT 2|${date}|14:00:00|15:00:00`);
});
