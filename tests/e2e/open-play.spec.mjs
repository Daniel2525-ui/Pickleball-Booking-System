// Open play end to end: local Supabase stack only.
import { test, expect } from "@playwright/test";
import { requireLocalDb, writesAllowed, sql, account, login, tomorrowManila, resetBookings, openAllBookings } from "./local-db.mjs";

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 412, height: 915 } });

const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
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
  await page.goto("/#booking");
  await page.getByRole("button", { name: "See the full board" }).click();
  await page.getByRole("button", { name: /Tmrw/ }).click();
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
  const item = page.getByRole("listitem").filter({ hasText: shortDate });
  await expect(item.getByText("6 of 6")).toBeVisible();
  await expect(item).toContainText("spots left");
});

test("a player books two spots with GCash and staff approve them", async ({ page }) => {
  sql(`UPDATE public.booking_settings SET gcash_account_name = 'Pickle Club Co.', gcash_number = '09171234567'`);
  await login(page, account("CUSTOMER"));
  await page.goto("/open-play");
  await page.getByRole("button", { name: `Book a spot on ${shortDate}` }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "One more spot" }).click();
  await dialog.getByRole("radio", { name: "GCash" }).click();
  await expect(dialog.getByText("₱300")).toBeVisible();
  await dialog.getByRole("button", { name: "Continue to Checkout" }).click();
  await page.waitForURL(/\/book\/gcash\?basket=/);
  await page.getByLabel("GCash reference number").fill("7770001");
  await page.getByLabel("Payment screenshot").setInputFiles({ name: "proof.png", mimeType: "image/png", buffer: PNG_1X1 });
  await page.getByRole("button", { name: "Submit payment" }).click();
  await expect(page.getByText("Payment submitted")).toBeVisible();
  expect(sql(`SELECT b.status || '|' || b.open_play_spots || '|' || p.status || '|' || p.payment_method FROM public.bookings b JOIN public.payments p ON p.booking_id = b.id WHERE b.open_play_session_id = '${sessionId()}'`))
    .toBe("pending|2|pending|gcash");

  await page.context().clearCookies();
  await login(page, account("ADMIN"));
  await openAllBookings(page);
  await page.getByRole("combobox").first().click();
  await page.getByRole("option", { name: /Awaiting Verification/ }).click();
  await page.getByRole("row").filter({ hasText: "Open play" }).first().getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("menuitem", { name: "Verify" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Approve — mark paid" }).click();
  await expect.poll(() => sql(`SELECT status FROM public.bookings WHERE open_play_session_id = '${sessionId()}' AND court_id IS NULL`)).toBe("confirmed");

  // The Bookings table lists the player's spot booking, but not the ₱0 rows that reserve the courts
  expect(Number(sql(`SELECT count(*) FROM public.bookings WHERE open_play_session_id = '${sessionId()}' AND court_id IS NOT NULL`))).toBeGreaterThan(0);
  await openAllBookings(page);
  await expect(page.getByRole("row").filter({ hasText: "Open play · 2 spots" })).toHaveCount(1);
  await expect(page.getByText("Open play (court reserved)")).toHaveCount(0);
  await expect(page.getByRole("row").filter({ hasText: "₱0" })).toHaveCount(0);

  await page.context().clearCookies();
  await login(page, account("CUSTOMER"));
  await page.goto("/my-bookings");
  await expect(page.getByText("Open play · 2 spots")).toBeVisible();
  await expect(page.getByText("CONFIRMED PASS")).toBeVisible();
  await page.goto("/open-play");
  await expect(page.getByRole("listitem").filter({ hasText: shortDate }).getByText("4 of 6")).toBeVisible();
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

test("staff add a walk-up and cancel the session, and payments land in Refund Owed", async ({ page }) => {
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

  await page.getByRole("button", { name: "Cancel session & refund everyone" }).click();
  await page.getByRole("alertdialog").or(page.getByRole("dialog")).getByRole("button", { name: "Cancel session & refund everyone" }).click();
  await expect(page.getByText("Session cancelled. Card payments are being refunded.")).toBeVisible();
  expect(sql(`SELECT string_agg(DISTINCT status, ',') FROM public.bookings WHERE open_play_session_id = '${sessionId()}'`)).toBe("cancelled");
  expect(sql(`SELECT status FROM public.open_play_sessions WHERE session_date = '${date}'`)).toBe("cancelled");

  await page.goto(`/admin/payments?status=${encodeURIComponent("Refund Owed")}`);
  await expect(page.getByRole("row").filter({ hasText: "E2E Walkup Wendy" })).toHaveCount(1);
  await expect(page.getByRole("row").filter({ hasText: "₱" })).toHaveCount(2);
  expect(sql(`SELECT count(*) FROM public.payments p JOIN public.bookings b ON b.id = p.booking_id WHERE b.open_play_session_id = '${sessionId()}' AND p.status = 'paid'`)).toBe("2");

  await openTomorrow(page);
  await expect(page.locator("#booking").getByRole("button", { name: "Select COURT 1 at 7:00 PM - 8:00 PM" })).toBeVisible();
});
