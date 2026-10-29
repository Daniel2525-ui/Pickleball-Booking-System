// Creates real holds, Stripe test-mode sessions and payments: local Supabase stack only.
import { test, expect } from "@playwright/test";
import { writesAllowed, requireLocalDb, sql, account, login, tomorrowManila, resetBookings, firstCourt } from "./local-db.mjs";

test.describe.configure({ mode: "serial" });
// Phone width shows the quick-date strip ("Tmrw"), the simplest stable way to pick tomorrow
test.use({ viewport: { width: 412, height: 915 } });

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

async function payOnStripe(page) {
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30_000 });
  const email = page.locator("#email");
  if (await email.isVisible().catch(() => false)) await email.fill("e2e-customer@example.com");
  await page.locator("#cardNumber").fill("4242 4242 4242 4242");
  await page.locator("#cardExpiry").fill("12 / 34");
  await page.locator("#cardCvc").fill("123");
  await page.locator("#billingName").fill("E2E Customer");
  const postal = page.locator("#billingPostalCode");
  if (await postal.isVisible().catch(() => false)) await postal.fill("10001");
  await page.getByTestId("hosted-payment-submit-button").click();
}

test("duration picker prices 1, 2 and 3 hours at PHP 200 per hour", async ({ page }) => {
  await login(page, account("CUSTOMER"));
  await openTomorrow(page);
  await slot(page, "08:00 AM - 09:00 AM").click();
  const panel = page.locator("#booking");
  await expect(panel.getByText("₱200", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "2 hrs" }).click();
  await expect(panel.getByText("₱400", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "3 hrs" }).click();
  await expect(panel.getByText("₱600", { exact: true })).toBeVisible();
  await expect(panel.getByText("(3 hrs × ₱200)")).toBeVisible();
});

test("successful Stripe test checkout confirms the booking", async ({ page }) => {
  await login(page, account("CUSTOMER"));
  await openTomorrow(page);
  await slot(page, "10:00 AM - 11:00 AM").click();
  await page.locator("#booking").getByRole("button", { name: "2 hrs" }).click();
  await page.locator("#booking").getByRole("button", { name: "Continue to Checkout" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Continue to Checkout" }).click();

  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30_000 });
  expect(bookingRow("10:00")).toBe("pending|pending|400.00");

  await payOnStripe(page);
  await page.waitForURL(/\/book\/success\?session_id=/, { timeout: 60_000 });
  await expect(page.getByText("Confirmed & Paid")).toBeVisible({ timeout: 30_000 });
  expect(bookingRow("10:00")).toBe("confirmed|paid|400.00");
});

test("a second customer cannot take a confirmed slot", async ({ page }) => {
  await login(page, account("CUSTOMER2"));
  await openTomorrow(page);
  await expect(page.locator("#booking").getByLabel(`${court.name} at 10:00 AM - 11:00 AM is booked`)).toBeVisible();
  await expect(slot(page, "10:00 AM - 11:00 AM")).toHaveCount(0);

  const res = await page.request.post("/api/stripe/checkout", {
    data: { court_id: court.id, booking_date: date, start_time: "10:00", end_time: "11:00" },
  });
  expect(res.status()).toBe(409);
  expect(sql(`SELECT count(*) FROM public.bookings WHERE booking_date = '${date}' AND start_time = '10:00'`)).toBe("1");
});

test("cancelled checkout leaves a pending hold the customer can cancel", async ({ page }) => {
  await login(page, account("CUSTOMER"));
  await openTomorrow(page);
  await slot(page, "01:00 PM - 02:00 PM").click();
  await page.locator("#booking").getByRole("button", { name: "Continue to Checkout" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Continue to Checkout" }).click();
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30_000 });

  // Stripe's back link goes to cancel_url (/book), which redirects to the grid
  await page.goto("/book");
  await page.getByRole("button", { name: /Tmrw/ }).click();
  await expect(page.locator("#booking").getByLabel(`Resume your pending booking for ${court.name} at 01:00 PM - 02:00 PM`)).toBeVisible();
  expect(bookingRow("13:00")).toBe("pending|pending|200.00");

  await page.goto("/my-bookings");
  await page.getByRole("button", { name: "Cancel Reservation" }).first().click();
  await page.getByRole("button", { name: "Yes, Cancel Reservation" }).click();
  await expect.poll(() => bookingRow("13:00").split("|")[0]).toBe("cancelled");
});

test("an expired hold keeps its slot for the grace period, then releases it", async ({ page, browser }) => {
  const holdA = await browser.newPage();
  await login(holdA, account("CUSTOMER"));
  const body = { court_id: court.id, booking_date: date, start_time: "15:00", end_time: "16:00" };
  expect((await holdA.request.post("/api/stripe/checkout", { data: body })).status()).toBe(200);
  await holdA.close();

  await login(page, account("CUSTOMER2"));
  sql(`UPDATE public.bookings SET hold_expires_at = now() - interval '5 minutes' WHERE booking_date = '${date}' AND start_time = '15:00'`);
  expect((await page.request.post("/api/stripe/checkout", { data: body })).status()).toBe(409);

  sql(`UPDATE public.bookings SET hold_expires_at = now() - interval '25 minutes' WHERE booking_date = '${date}' AND start_time = '15:00' AND status = 'pending'`);
  expect((await page.request.post("/api/stripe/checkout", { data: body })).status()).toBe(200);
  expect(sql(`SELECT string_agg(status, ',' ORDER BY created_at) FROM public.bookings WHERE booking_date = '${date}' AND start_time = '15:00'`)).toBe("cancelled,pending");
});
