// Open play end to end: local Supabase stack only.
import { test, expect } from "@playwright/test";
import { requireLocalDb, writesAllowed, sql, account, login, tomorrowManila, resetBookings, pickDay } from "./local-db.mjs";

test.describe.configure({ mode: "serial" });
// Desktop layout: the grid shows every court at once (phones show one court at a time)
test.use({ viewport: { width: 1280, height: 900 } });

// Tomorrow's weekday: the first generated session is tomorrow, on a day with no other bookings
const date = tomorrowManila();
const weekday = new Date(`${date}T12:00:00+08:00`).toLocaleDateString("en-US", { weekday: "long", timeZone: "Asia/Manila" });
const shortDate = new Date(`${date}T00:00:00+08:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "Asia/Manila" });

function wipe() {
  resetBookings();
  sql(`DELETE FROM public.open_play_sessions; DELETE FROM public.open_play_schedules;
       UPDATE public.booking_settings SET gcash_account_name = NULL, gcash_number = NULL;`);
}

test.beforeAll(() => { if (writesAllowed) wipe(); });
test.afterAll(() => { if (writesAllowed) wipe(); });
test.beforeEach(() => requireLocalDb());

async function openTomorrow(page) {
  await page.goto("/book");
  await pickDay(page, 1);
}

const sessionId = () => sql(`SELECT id FROM public.open_play_sessions WHERE session_date = '${date}'`);

test("admin schedules open play and the court grid shows it", async ({ page }) => {
  await login(page, account("ADMIN"));
  await page.goto("/admin/open-play");
  await page.getByRole("button", { name: "Add weekly session" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox").click();
  await page.getByRole("option", { name: weekday, exact: true }).click();
  await dialog.getByLabel("Start").fill("18:00");
  await dialog.getByLabel("End").fill("21:00");
  await dialog.getByLabel("COURT 1").check();
  await dialog.getByLabel("Spots").fill("6");
  await dialog.getByLabel("Price per spot (₱)").fill("150");
  await dialog.getByRole("button", { name: "Save schedule" }).click();
  await expect(page.getByText(`Every ${weekday}`)).toBeVisible();
  expect(sql(`SELECT status || '|' || capacity FROM public.open_play_sessions WHERE session_date = '${date}'`)).toBe("open|6");

  await openTomorrow(page);
  for (const t of ["6:00 PM - 7:00 PM", "7:00 PM - 8:00 PM", "8:00 PM - 9:00 PM"]) {
    await expect(page.locator("#booking").getByLabel(`COURT 1 at ${t} is open play`)).toBeVisible();
  }
  await expect(page.locator("#booking").getByLabel("COURT 1 at 9:00 PM - 10:00 PM is open play")).toHaveCount(0);

  await page.goto("/open-play");
  // The date sits in the day heading, so find the card by its button's label
  const item = page.getByRole("listitem").filter({ has: page.getByRole("button", { name: new RegExp(shortDate) }) });
  await expect(item.getByText("6 of 6")).toBeVisible();
  await expect(item).toContainText("spots left");
});

test("a player books two spots and, once paid, holds them", async ({ page }) => {
  await login(page, account("CUSTOMER"));
  await page.goto("/open-play");
  await page.getByRole("button", { name: new RegExp(`^Book a spot on ${shortDate}`) }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("No account needed.")).toHaveCount(0);
  await dialog.getByRole("button", { name: "One more spot" }).click();
  await expect(dialog.getByText("₱300")).toBeVisible();
  await dialog.getByRole("button", { name: "Continue to Checkout" }).click();
  if (process.env.XENDIT_SECRET_KEY) await page.waitForURL(/\/book\/qr\?pr=/, { timeout: 30_000 });
  else await expect(dialog.getByRole("alert")).toBeVisible({ timeout: 30_000 });
  const booking = sql(`SELECT id FROM public.bookings WHERE open_play_session_id = '${sessionId()}' AND court_id IS NULL ORDER BY created_at DESC LIMIT 1`);
  expect(sql(`SELECT open_play_spots || '|' || total_amount FROM public.bookings WHERE id = '${booking}'`)).toBe("2|300.00");

  // Stands in for the QR Ph webhook (no Xendit key locally): the spots are paid for
  sql(`UPDATE public.bookings SET status = 'confirmed', cancel_reason = NULL, hold_expires_at = NULL WHERE id = '${booking}';
       UPDATE public.payments SET status = 'paid', paid_at = now() WHERE booking_id = '${booking}';`);
  await page.goto("/open-play");
  const card = page.getByRole("listitem").filter({ has: page.getByRole("button", { name: new RegExp(`on ${shortDate}`) }) });
  await expect(card.getByText("4 of 6 spots left")).toBeVisible();
  await expect(card.getByText("You have 2")).toBeVisible();
});

test("the dashboard schedule shows how full today's open play session is", async ({ page }) => {
  // Move the approved session (2 of 6 spots) to today for this check only, then put it back
  const id = sessionId();
  const today = sql("SELECT (now() AT TIME ZONE 'Asia/Manila')::date::text");
  const move = (day) => sql(`UPDATE public.open_play_sessions SET session_date = '${day}' WHERE id = '${id}';
                             UPDATE public.bookings SET booking_date = '${day}' WHERE open_play_session_id = '${id}'`);
  move(today);
  try {
    await login(page, account("ADMIN"));
    await page.goto("/admin/dashboard");
    await expect(page.getByText("2 / 6 spots booked").first()).toBeVisible();
  } finally {
    move(date);
  }
});

test("staff add a walk-up and cancel the session, and paid players can be refunded", async ({ page }) => {
  await login(page, account("ADMIN"));
  await page.goto("/admin/open-play");
  await page.getByRole("row").filter({ hasText: shortDate }).getByRole("button", { name: "Actions" }).click();
  await page.getByRole("menuitem", { name: "Players" }).click();
  await page.getByRole("button", { name: "Add player" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Player").fill("E2E Walkup Wendy");
  await dialog.getByRole("button", { name: /as a new walk-in/ }).click();
  await expect(dialog.getByText("E2E Walkup Wendy")).toBeVisible();
  await dialog.getByRole("button", { name: "Add player" }).click();
  await expect(page.getByText("Player added.")).toBeVisible();
  await expect(page.getByText("3 of 6 spots booked")).toBeVisible();

  await page.getByRole("button", { name: "Cancel session", exact: true }).click();
  await page.getByRole("alertdialog").or(page.getByRole("dialog")).getByRole("button", { name: "Cancel session", exact: true }).click();
  await expect(page.getByText("Session cancelled. Refund players who ask from the Payments page.")).toBeVisible();
  expect(sql(`SELECT string_agg(DISTINCT status, ',') FROM public.bookings WHERE open_play_session_id = '${sessionId()}'`)).toBe("cancelled");
  expect(sql(`SELECT status FROM public.open_play_sessions WHERE session_date = '${date}'`)).toBe("cancelled");

  await page.goto("/admin/payments");
  await expect(page.getByRole("row").filter({ hasText: "E2E Walkup Wendy" }).getByRole("button", { name: "Refund" })).toHaveCount(1);
  expect(sql(`SELECT count(*) FROM public.payments p JOIN public.bookings b ON b.id = p.booking_id WHERE b.open_play_session_id = '${sessionId()}' AND p.status = 'paid'`)).toBe("2");

  await openTomorrow(page);
  await expect(page.locator("#booking").getByRole("button", { name: "Select COURT 1 at 7:00 PM - 8:00 PM" })).toBeVisible();
});
