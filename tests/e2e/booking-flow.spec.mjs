// Creates real holds, QR Ph test-mode payments and payments: local Supabase stack only.
import { test, expect } from "@playwright/test";
import { writesAllowed, requireLocalDb, requireQrPh, sql, account, login, tomorrowManila, resetBookings, firstCourt, localSupabase, payWithQrPh } from "./local-db.mjs";

test.describe.configure({ mode: "serial" });
// Phone width shows the quick-date strip ("Tmrw"), the simplest stable way to pick tomorrow
// Desktop layout: the grid shows every court at once (phones show one court at a time)
test.use({ viewport: { width: 1280, height: 900 } });

let court;
const date = tomorrowManila();

test.beforeAll(() => {
  if (!writesAllowed) return;
  resetBookings();
  court = firstCourt();
});
test.beforeEach(() => requireLocalDb());

async function openTomorrow(page) {
  await page.goto("/#booking");
  await page.getByRole("button", { name: /Tmrw/ }).click();
}

const slot = (page, time) => page.locator("#booking").getByRole("button", { name: `Select ${court.name} at ${time}` });
const bookingRow = (start) =>
  sql(`SELECT b.status || '|' || coalesce(p.status, '') || '|' || b.total_amount FROM public.bookings b
       LEFT JOIN public.payments p ON p.booking_id = b.id
       WHERE b.court_id = '${court.id}' AND b.booking_date = '${date}' AND b.start_time = '${start}'
       ORDER BY b.created_at DESC LIMIT 1`);

test("duration picker prices 1, 2 and 3 hours at PHP 200 per hour", async ({ page }) => {
  await login(page, account("CUSTOMER"));
  await openTomorrow(page);
  await slot(page, "8:00 AM - 9:00 AM").click();
  const panel = page.getByRole("region", { name: "Your selection" });
  const line = panel.getByRole("group", { name: new RegExp(`^${court.name} .+ selection line$`) });
  await expect(panel.getByText("₱200", { exact: true }).last()).toBeVisible();
  await line.getByRole("button", { name: "One hour longer" }).click();
  await expect(panel.getByText("₱400", { exact: true }).last()).toBeVisible();
  await line.getByRole("button", { name: "One hour longer" }).click();
  await expect(line.getByText("3 hrs", { exact: true })).toBeVisible();
  await expect(panel.getByText("₱600", { exact: true }).last()).toBeVisible();
  await expect(panel.getByText("Total", { exact: true })).toBeVisible();
});

test("a QR Ph test payment confirms the booking", async ({ page }) => {
  await login(page, account("CUSTOMER"));
  await openTomorrow(page);
  await slot(page, "10:00 AM - 11:00 AM").click();
  await page.getByRole("group", { name: new RegExp(`^${court.name} .+ selection line$`) }).getByRole("button", { name: "One hour longer" }).click();
  await page.locator("#booking").getByRole("button", { name: "Continue to Checkout" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^Pay ₱[\d,]+ with QR Ph$/ }).click();

  requireQrPh();
  await page.waitForURL(/\/book\/qr\?pr=/, { timeout: 30_000 });
  expect(bookingRow("10:00")).toBe("pending|pending|400.00");

  await payWithQrPh(page);
  await page.waitForURL(/\/book\/success\?session_id=/, { timeout: 60_000 });
  await expect(page.getByText("Confirmed & Paid")).toBeVisible({ timeout: 30_000 });
  expect(bookingRow("10:00")).toBe("confirmed|paid|400.00");
});

test("a second customer cannot take a confirmed slot", async ({ page }) => {
  requireQrPh();
  await login(page, account("CUSTOMER2"));
  await openTomorrow(page);
  await expect(page.locator("#booking").getByLabel(`${court.name} at 10:00 AM - 11:00 AM is booked`)).toBeVisible();
  await expect(slot(page, "10:00 AM - 11:00 AM")).toHaveCount(0);

  const res = await page.request.post("/api/stripe/checkout", {
    data: { booking_date: date, lines: [{ court_id: court.id, start_time: "10:00", end_time: "11:00" }] },
  });
  expect(res.status()).toBe(409);
  expect(sql(`SELECT count(*) FROM public.bookings WHERE booking_date = '${date}' AND start_time = '10:00'`)).toBe("1");
});

test("a paid booking is non-refundable: no cancel button, and the cancel route refuses it", async ({ page }) => {
  requireQrPh(); // uses the booking paid in the test above
  await login(page, account("CUSTOMER"));
  await page.goto("/my-bookings");
  await expect(page.getByText(/Paid bookings are non-refundable/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel Reservation" })).toHaveCount(0);
  const id = sql(`SELECT id FROM public.bookings WHERE booking_date = '${date}' AND start_time = '10:00'`);
  const res = await page.request.post("/api/bookings/cancel", { data: { bookingId: id } });
  expect(res.status()).toBe(409);
  expect(bookingRow("10:00")).toBe("confirmed|paid|400.00");
});

test("leaving the QR page leaves a pending hold the customer can cancel", async ({ page }) => {
  requireQrPh();
  await login(page, account("CUSTOMER"));
  await openTomorrow(page);
  await slot(page, "1:00 PM - 2:00 PM").click();
  await page.locator("#booking").getByRole("button", { name: "Continue to Checkout" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^Pay ₱[\d,]+ with QR Ph$/ }).click();
  await page.waitForURL(/\/book\/qr\?pr=/, { timeout: 30_000 });

  // The player leaves the QR page without paying
  await page.goto("/");
  await openTomorrow(page);
  await expect(page.locator("#booking").getByLabel(`Resume your pending booking for ${court.name} at 1:00 PM - 2:00 PM`)).toBeVisible();
  expect(bookingRow("13:00")).toBe("pending|pending|200.00");

  // "Continue Payment" on an unpaid hold reopens the QR Ph payment for the same booking
  const holdId = sql(`SELECT id FROM public.bookings WHERE booking_date = '${date}' AND start_time = '13:00'`);
  const resumed = await page.request.post("/api/bookings/resume-payment", { data: { bookingId: holdId } });
  expect(resumed.status()).toBe(200);
  expect((await resumed.json()).url).toMatch(/^\/book\/qr\?pr=/);

  await page.goto("/my-bookings");
  await page.getByRole("button", { name: "Cancel Reservation" }).first().click();
  await page.getByRole("button", { name: "Yes, Cancel Reservation" }).click();
  await expect.poll(() => bookingRow("13:00").split("|")[0]).toBe("cancelled");
});

test("a paid but not yet confirmed booking cannot be paid a second time", async ({ page }) => {
  requireQrPh();
  await login(page, account("CUSTOMER"));
  // Stand in for a late webhook: the success page (which confirms the booking) never loads
  await page.route("**/book/success**", (route) => route.fulfill({ contentType: "text/html", body: "<p>held</p>" }));
  await openTomorrow(page);
  await slot(page, "5:00 PM - 6:00 PM").click();
  await page.locator("#booking").getByRole("button", { name: "Continue to Checkout" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^Pay ₱[\d,]+ with QR Ph$/ }).click();
  await payWithQrPh(page);
  await page.waitForURL(/\/book\/success/, { timeout: 60_000 });
  expect(bookingRow("17:00")).toBe("pending|pending|200.00");

  const bookingId = sql(`SELECT id FROM public.bookings WHERE booking_date = '${date}' AND start_time = '17:00'`);
  const res = await page.request.post("/api/bookings/resume-payment", { data: { bookingId } });
  expect(res.status()).toBe(409);
  expect(sql(`SELECT count(*) FROM public.payments WHERE booking_id = '${bookingId}'`)).toBe("1");
});

test("a customer cannot cancel a confirmed booking around the cancel route", async ({ page }) => {
  requireQrPh();
  await login(page, account("CUSTOMER2"));
  const body = { booking_date: date, lines: [{ court_id: court.id, start_time: "20:00", end_time: "21:00" }] };
  expect((await page.request.post("/api/stripe/checkout", { data: body })).status()).toBe(200);
  sql(`UPDATE public.bookings SET status = 'confirmed' WHERE booking_date = '${date}' AND start_time = '20:00'`);
  const bookingId = sql(`SELECT id FROM public.bookings WHERE booking_date = '${date}' AND start_time = '20:00'`);

  // Direct PostgREST call with the customer's own token and the public anon key, as a browser console could
  const { url, anonKey } = localSupabase();
  const { email, password } = account("CUSTOMER2");
  const auth = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  }).then((r) => r.json());
  const res = await fetch(`${url}/rest/v1/bookings?id=eq.${bookingId}`, {
    method: "PATCH",
    headers: { apikey: anonKey, Authorization: `Bearer ${auth.access_token}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ status: "cancelled" }),
  });
  expect(res.ok).toBe(true);
  expect(await res.json()).toEqual([]);
  expect(sql(`SELECT status FROM public.bookings WHERE id = '${bookingId}'`)).toBe("confirmed");
});

test("an expired hold keeps its slot for the grace period, then releases it", async ({ page, browser }) => {
  requireQrPh();
  // The paid-but-unconfirmed 5 PM hold above still counts as CUSTOMER's one open basket; age it out
  sql(`UPDATE public.bookings SET hold_expires_at = now() - interval '25 minutes' WHERE booking_date = '${date}' AND start_time = '17:00' AND status = 'pending'`);
  const holdA = await browser.newPage();
  await login(holdA, account("CUSTOMER"));
  const body = { booking_date: date, lines: [{ court_id: court.id, start_time: "15:00", end_time: "16:00" }] };
  expect((await holdA.request.post("/api/stripe/checkout", { data: body })).status()).toBe(200);
  await holdA.close();

  await login(page, account("CUSTOMER2"));
  sql(`UPDATE public.bookings SET hold_expires_at = now() - interval '5 minutes' WHERE booking_date = '${date}' AND start_time = '15:00'`);
  expect((await page.request.post("/api/stripe/checkout", { data: body })).status()).toBe(409);

  sql(`UPDATE public.bookings SET hold_expires_at = now() - interval '25 minutes' WHERE booking_date = '${date}' AND start_time = '15:00' AND status = 'pending'`);
  expect((await page.request.post("/api/stripe/checkout", { data: body })).status()).toBe(200);
  expect(sql(`SELECT string_agg(status, ',' ORDER BY created_at) FROM public.bookings WHERE booking_date = '${date}' AND start_time = '15:00'`)).toBe("cancelled,pending");
});
