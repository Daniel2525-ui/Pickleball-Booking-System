// Records walk-in reservations: local Supabase stack only.
import { test, expect } from "@playwright/test";
import { writesAllowed, requireLocalDb, sql, account, login, tomorrowManila, resetBookings, firstCourt } from "./local-db.mjs";

test.describe.configure({ mode: "serial" });

let court;
const date = tomorrowManila();

test.beforeAll(() => {
  if (!writesAllowed) return;
  resetBookings();
  court = firstCourt();
});
test.beforeEach(() => requireLocalDb());

async function recordWalkIn(page, name, start, end) {
  await page.goto("/admin/bookings");
  await page.getByRole("button", { name: "New Reservation" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "New Walk-In" }).click();
  await dialog.getByPlaceholder("e.g. Juan Dela Cruz").fill(name);
  await dialog.getByRole("combobox").click();
  await page.getByRole("option", { name: court.name }).click();
  await dialog.locator('input[type="date"]').fill(date);
  await dialog.locator('input[type="time"]').nth(0).fill(start);
  await dialog.locator('input[type="time"]').nth(1).fill(end);
  await dialog.getByPlaceholder("e.g. 200").fill("200");
  await dialog.getByRole("button", { name: "Cash (Paid)" }).click();
  await dialog.getByRole("button", { name: "Record Reservation" }).click();
  return dialog;
}

test("a customer cannot open the admin area", async ({ page }) => {
  await login(page, account("CUSTOMER"));
  await page.goto("/admin/bookings");
  await expect(page).toHaveURL(/\/$/);
});

test("admin records a paid cash walk-in", async ({ page }) => {
  await login(page, account("ADMIN"));
  await expect(page).toHaveURL(/\/admin\/dashboard$/);
  await recordWalkIn(page, "E2E Walk In", "18:00", "19:00");
  await expect(page.getByText("Reservation recorded successfully!")).toBeVisible();
  expect(
    sql(`SELECT b.status || '|' || p.status || '|' || p.payment_method || '|' || p.amount FROM public.bookings b
         JOIN public.payments p ON p.booking_id = b.id
         WHERE b.booking_date = '${date}' AND b.start_time = '18:00'`)
  ).toBe("confirmed|paid|cash|200.00");
});

test("admin cannot double-book the walk-in slot", async ({ page }) => {
  await login(page, account("ADMIN"));
  const dialog = await recordWalkIn(page, "E2E Second Walk In", "18:00", "19:00");
  await expect(dialog.getByText(/SLOT_UNAVAILABLE|already|unavailable/i)).toBeVisible();
  expect(sql(`SELECT count(*) FROM public.bookings WHERE booking_date = '${date}' AND start_time = '18:00'`)).toBe("1");
});
