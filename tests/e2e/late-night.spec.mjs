// A day open past midnight: its after-midnight hours are booked from that day's grid, stored on the next date.
// Local Supabase stack only.
import { test, expect } from "@playwright/test";
import { writesAllowed, requireLocalDb, sql, account, login, tomorrowManila, resetBookings, payWithQrPh, requireQrPh, pickDay } from "./local-db.mjs";

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1280, height: 900 } });

const day = tomorrowManila();
const next = sql(`SELECT ('${day}'::date + 1)::text`);
const weekday = sql(`SELECT to_char('${day}'::date, 'FMDay')`);
let dayEndsAt;

test.beforeAll(() => {
  if (!writesAllowed) return;
  resetBookings();
  dayEndsAt = sql("SELECT day_ends_at FROM public.booking_settings");
  // Tomorrow runs 6 AM to 2 AM; the venue's day ends at 4 AM so that close is allowed
  sql(`UPDATE public.booking_settings SET day_ends_at = '04:00';
       UPDATE public.operating_hours SET close_time = '02:00' WHERE day_of_week = '${weekday}';`);
});
test.afterAll(() => {
  if (!writesAllowed) return;
  resetBookings();
  sql(`UPDATE public.booking_settings SET day_ends_at = '${dayEndsAt}'`);
});
test.beforeEach(() => requireLocalDb());

const courtId = (name) => sql(`SELECT id FROM public.courts WHERE name = '${name}'`);
const grid = (page) => page.locator("#booking");
const slot = (page, court, time) => grid(page).getByRole("button", { name: `Select ${court} at ${time}` }).filter({ visible: true });
const basket = (page) => page.getByRole("region", { name: "Your selection" });

async function openTomorrow(page) {
  await page.goto("/#booking", { waitUntil: "load" });
  await pickDay(page, 1);
}

test("the after-midnight hours sit at the bottom of their own day, and not on the next date", async ({ page }) => {
  await openTomorrow(page);
  await expect(grid(page).getByText("After midnight", { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(slot(page, "COURT 1", "11:00 PM - 12:00 AM")).toBeVisible();
  await expect(slot(page, "COURT 1", "12:00 AM - 1:00 AM")).toBeVisible();
  await expect(slot(page, "COURT 1", "1:00 AM - 2:00 AM")).toBeVisible();
  await expect(grid(page).getByText(/open till 2:00 AM/)).toBeVisible();

  await pickDay(page, 2);
  await expect(slot(page, "COURT 1", "6:00 AM - 7:00 AM")).toBeVisible();
  await expect(slot(page, "COURT 1", "12:00 AM - 1:00 AM")).toHaveCount(0);
  await expect(grid(page).getByText("After midnight", { exact: true })).toHaveCount(0);
});

test("11 PM to 1 AM on one court is one line, priced as two hours, and the server holds it as two bookings", async ({ page }) => {
  await login(page, account("CUSTOMER"));
  await openTomorrow(page);
  await slot(page, "COURT 1", "11:00 PM - 12:00 AM").click();
  await slot(page, "COURT 1", "12:00 AM - 1:00 AM").click();
  await expect(basket(page).getByRole("group", { name: "COURT 1 11:00 PM - 1:00 AM selection line" })).toBeVisible();
  await expect(basket(page).getByText("₱400", { exact: true }).last()).toBeVisible();

  // The API takes a date per line; Friday-night hours posted as the next date's own are refused
  const c1 = courtId("COURT 1");
  const own = await page.request.post("/api/stripe/checkout", {
    data: { player_count: 2, booking_date: next, lines: [{ court_id: c1, start_time: "00:00", end_time: "01:00" }] },
  });
  expect(own.status()).toBe(400);
  expect((await own.json()).error).toMatch(/outside venue operating hours/);

  if (!process.env.XENDIT_SECRET_KEY) {
    // Without QR Ph the holds are made, then released when the payment can't open: proof the database took both dates
    const res = await page.request.post("/api/stripe/checkout", {
      data: { player_count: 2, booking_date: day, lines: [
        { court_id: c1, booking_date: day, start_time: "23:00", end_time: "24:00" },
        { court_id: c1, booking_date: next, start_time: "00:00", end_time: "01:00" },
      ] },
    });
    expect(res.status()).toBe(400);
    expect(
      sql(`SELECT string_agg(booking_date || ' ' || start_time || '-' || end_time || ' ' || business_date || ' ' || cancel_reason, ',' ORDER BY booking_date)
           || '|' || count(DISTINCT basket_id) FROM public.bookings WHERE court_id = '${c1}'`)
    ).toBe(`${day} 23:00:00-24:00:00 ${day} checkout_failed,${next} 00:00:00-01:00:00 ${day} checkout_failed|1`);
    return;
  }

  await basket(page).getByRole("button", { name: "Continue to Checkout" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^Pay ₱400 with QR Ph$/ }).click();
  await payWithQrPh(page);
  await page.waitForURL(/\/book\/success\?session_id=/, { timeout: 60_000 });
  expect(
    sql(`SELECT string_agg(booking_date || ' ' || start_time || '-' || end_time || ' ' || status, ',' ORDER BY booking_date)
         || '|' || count(DISTINCT basket_id) FROM public.bookings WHERE court_id = '${c1}'`)
  ).toBe(`${day} 23:00:00-24:00:00 confirmed,${next} 00:00:00-01:00:00 confirmed|1`);
});

test("a requirement of two hours counts the run across midnight", async ({ page }) => {
  sql("UPDATE public.booking_settings SET min_hours = 2");
  try {
    await login(page, account("CUSTOMER"));
    const res = await page.request.post("/api/stripe/checkout", {
      data: { player_count: 2, booking_date: day, lines: [{ court_id: courtId("COURT 2"), booking_date: next, start_time: "01:00", end_time: "02:00" }] },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toMatch(/at least 2 hours/);
  } finally {
    sql("UPDATE public.booking_settings SET min_hours = 1");
  }
});
