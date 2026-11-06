// Booking history: who did what, recorded by the database for every path; staff only. Local Supabase stack only.
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { writesAllowed, requireLocalDb, sql, account, login, tomorrowManila, resetBookings, firstCourt, localSupabase, openAllBookings } from "./local-db.mjs";

test.describe.configure({ mode: "serial" });

const date = tomorrowManila();
let court;

test.beforeAll(() => {
  if (!writesAllowed) return;
  resetBookings();
  court = firstCourt();
});
test.afterAll(() => { if (writesAllowed) resetBookings(); });
test.beforeEach(() => requireLocalDb());

const rowFor = (page, name) => page.getByRole("row").filter({ hasText: name });

async function openMenu(page, name) {
  await rowFor(page, name).getByRole("button", { name: "Open menu" }).click();
}

async function historyLines(page, name) {
  await openMenu(page, name);
  await page.getByRole("menuitem", { name: "History" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("listitem").first()).toBeVisible();
  const lines = await dialog.getByRole("listitem").allInnerTexts();
  await page.keyboard.press("Escape");
  return lines.map((l) => l.replace(/\s+/g, " ").trim());
}

test("a walk-in's history names the staff member for each step", async ({ page }) => {
  await login(page, account("ADMIN"));
  await openAllBookings(page);

  // Walk-in, Pay Later
  await page.getByRole("button", { name: "New Reservation" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "New Walk-In" }).click();
  await dialog.getByLabel("Full Name").fill("E2E History");
  await dialog.getByLabel("Assigned Court").click();
  await page.getByRole("option", { name: court.name }).click();
  await dialog.getByLabel("Reservation Date").fill(date);
  await dialog.getByLabel("Start Time").fill("10:00");
  await dialog.getByLabel("End Time").fill("11:00");
  await dialog.getByRole("button", { name: "Pay Later", exact: true }).click();
  await dialog.getByRole("button", { name: "Record Reservation" }).click();
  await expect(dialog).toHaveCount(0);

  // Collect cash at the counter
  await openMenu(page, "E2E History");
  await page.getByRole("menuitem", { name: "Collect Payment" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Cash Payment" }).click();
  await dialog.getByRole("button", { name: /Confirm ₱200 Received/ }).click();
  await expect.poll(() => sql(`SELECT p.status FROM public.payments p JOIN public.bookings b ON b.id = p.booking_id WHERE b.customer_name = 'E2E History'`)).toBe("paid");

  // Move to COURT 2
  await openMenu(page, "E2E History");
  await page.getByRole("menuitem", { name: "Move Booking" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Court").click();
  await page.getByRole("option", { name: "COURT 2" }).click();
  await dialog.getByRole("button", { name: "Move Booking" }).click();
  await expect(dialog).toHaveCount(0);

  // Cancel
  await openMenu(page, "E2E History");
  await page.getByRole("menuitem", { name: "Cancel Reservation" }).click();
  await page.getByRole("dialog").getByLabel(/Cancel and refund/).check();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel Reservation" }).click();
  await expect.poll(() => sql(`SELECT status FROM public.bookings WHERE customer_name = 'E2E History'`)).toBe("cancelled");

  const lines = await historyLines(page, "E2E History");
  expect(lines[0]).toMatch(/^Booked by E2E Admin/);
  expect(lines[1]).toMatch(/^Payment recorded by E2E Admin Cash · ₱200/);
  expect(lines[2]).toMatch(new RegExp(`^Moved by E2E Admin ${court.name} · \\w+ \\d+ 10:00 AM → COURT 2 · \\w+ \\d+ 10:00 AM`));
  expect(lines[3]).toMatch(/^Cancelled by E2E Admin/);
  expect(lines).toHaveLength(4);
});

test("check-in is recorded by name, and changes made by the system show as System", async ({ page }) => {
  const hour = Number(sql("SELECT extract(hour FROM now() AT TIME ZONE 'Asia/Manila')"));
  test.skip(hour >= 21, "needs a slot later today");
  const userId = sql(`SELECT id FROM public.profiles WHERE email = '${account("CUSTOMER").email}'`);
  // Inserted straight into the database: no signed-in user, so the history says System
  sql(`INSERT INTO public.bookings (user_id, court_id, booking_date, start_time, end_time, status, total_amount, customer_name)
       VALUES ('${userId}', '${court.id}', (now() AT TIME ZONE 'Asia/Manila')::date, '21:00', '22:00', 'confirmed', 200, 'E2E Check In')`);

  await login(page, account("ADMIN"));
  await openAllBookings(page);
  await openMenu(page, "E2E Check In");
  await page.getByRole("menuitem", { name: "Check In Player" }).click();
  await expect(page.getByText("Player checked in.")).toBeVisible();

  const lines = await historyLines(page, "E2E Check In");
  expect(lines[0]).toMatch(/^Booked by System/);
  expect(lines[1]).toMatch(/^Checked in by E2E Admin/);
});

test("customers can't read booking history", async () => {
  const { url, anonKey } = localSupabase();
  const client = createClient(url, anonKey);
  const { error: signInError } = await client.auth.signInWithPassword(account("CUSTOMER"));
  expect(signInError).toBeNull();
  const { data, error } = await client.from("booking_events").select("id");
  expect(error).toBeNull();
  expect(data).toEqual([]);
  expect(Number(sql("SELECT count(*) FROM public.booking_events"))).toBeGreaterThan(0);

  const { error: writeError } = await client.from("booking_events").insert({ booking_id: sql("SELECT id FROM public.bookings LIMIT 1"), action: "forged" });
  expect(writeError).not.toBeNull();
});
