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

async function recordWalkIn(page, name, start, end, payment = "Cash (Paid)") {
  await page.goto("/admin/bookings");
  await page.getByRole("button", { name: "New Reservation" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "New Walk-In" }).click();
  await dialog.getByLabel("Full Name").fill(name);
  await dialog.getByLabel("Assigned Court").click();
  await page.getByRole("option", { name: court.name }).click();
  await dialog.getByLabel("Reservation Date").fill(date);
  await dialog.getByLabel("Start Time").fill(start);
  await dialog.getByLabel("End Time").fill(end);
  await dialog.getByLabel("Court Fee (₱ PHP)").fill("200");
  await dialog.getByRole("button", { name: payment, exact: true }).click();
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
  await expect(dialog.getByText("This court slot is no longer available. Please choose another time or court.")).toBeVisible();
  expect(sql(`SELECT count(*) FROM public.bookings WHERE booking_date = '${date}' AND start_time = '18:00'`)).toBe("1");

  // Retrying the rejected walk-in reuses the customer record instead of creating another
  await dialog.getByRole("button", { name: "Record Reservation" }).click();
  await expect(dialog.getByText("This court slot is no longer available. Please choose another time or court.")).toBeVisible();
  expect(sql(`SELECT count(*) FROM public.customers WHERE full_name = 'E2E Second Walk In'`)).toBe("1");
});

const rowFor = (page, name) => page.getByRole("row").filter({ hasText: name });

// Inserts a booking (plus its payment) for a test customer straight into the local database
function seed(name, start, end, status, reason, expiresSql, paymentStatus, { role = "CUSTOMER", day = date } = {}) {
  const customerId = sql(`SELECT id FROM public.profiles WHERE email = '${account(role).email}'`);
  // psql prints "INSERT 0 1" after the RETURNING row; keep the id line
  const id = sql(`INSERT INTO public.bookings (user_id, court_id, booking_date, start_time, end_time, status, cancel_reason, total_amount, hold_expires_at, customer_name)
    VALUES ('${customerId}', '${court.id}', '${day}', '${start}', '${end}', '${status}', ${reason}, 200, ${expiresSql}, '${name}') RETURNING id`).split(/\s+/)[0];
  sql(`INSERT INTO public.payments (booking_id, amount, currency, status) VALUES ('${id}', 200, 'php', '${paymentStatus}')`);
  return id;
}

test("expired holds are hidden by default, listed under Expired Holds, and cannot be paid at the counter", async ({ page }) => {
  seed("E2E Expired Hold", "06:00", "07:00", "cancelled", "'expired'", "now() - interval '2 hours'", "failed");
  seed("E2E Stale Hold", "07:00", "08:00", "pending", "NULL", "now() - interval '5 minutes'", "pending");

  await login(page, account("ADMIN"));
  await page.goto("/admin/bookings");
  const stale = rowFor(page, "E2E Stale Hold");
  await expect(stale.getByText("Hold Expired")).toBeVisible();
  await expect(rowFor(page, "E2E Expired Hold")).toHaveCount(0);

  await stale.getByRole("button", { name: "Open menu" }).click();
  await expect(page.getByRole("menuitem", { name: "Cancel Reservation" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Collect Payment" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.getByRole("combobox").filter({ hasText: "All Statuses" }).click();
  await page.getByRole("option", { name: "Expired Holds" }).click();
  await expect(rowFor(page, "E2E Expired Hold").getByText("Expired", { exact: true })).toBeVisible();
  await expect(rowFor(page, "E2E Stale Hold")).toHaveCount(0);
});

test("staff can collect payment for a Pay Later walk-in", async ({ page }) => {
  await login(page, account("ADMIN"));
  const dialog = await recordWalkIn(page, "E2E Pay Later", "20:00", "21:00", "Pay Later");
  await expect(dialog).toHaveCount(0);

  // The dashboard flags it as money to collect (the stale online hold seeded above is not counted)
  await page.goto("/admin/dashboard");
  await page.getByRole("link", { name: /1 booking to collect/ }).click();
  await expect(page).toHaveURL(/status=To%20Collect/);
  await expect(page.getByRole("row").filter({ hasText: "E2E Pay Later" })).toHaveCount(1);
  await expect(page.getByRole("row").filter({ hasText: "E2E Stale Hold" })).toHaveCount(0);

  await page.goto("/admin/bookings");
  const row = rowFor(page, "E2E Pay Later");
  await row.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("menuitem", { name: "Collect Payment" }).click();
  const settle = page.getByRole("dialog");
  await settle.getByRole("button", { name: "Cash Payment" }).click();
  await settle.getByRole("button", { name: /Confirm ₱200 Received/ }).click();
  await expect.poll(() =>
    sql(`SELECT b.status || '|' || p.status || '|' || p.payment_method FROM public.bookings b JOIN public.payments p ON p.booking_id = b.id
         WHERE b.booking_date = '${date}' AND b.start_time = '20:00'`)
  ).toBe("confirmed|paid|cash");
  await page.goto("/admin/dashboard");
  await page.waitForLoadState("networkidle"); // let the banner's count load before asserting it is absent
  await expect(page.getByRole("link", { name: /to collect/ })).toHaveCount(0);
});

test("cancelling a hold that already timed out records it as expired, not as a staff cancellation", async ({ page }) => {
  const id = seed("E2E Timed Out", "09:00", "10:00", "pending", "NULL", "now() - interval '5 minutes'", "pending");
  await login(page, account("ADMIN"));
  await page.goto("/admin/bookings");
  await rowFor(page, "E2E Timed Out").getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("menuitem", { name: "Cancel Reservation" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel Reservation" }).click();
  await expect.poll(() => sql(`SELECT status || '|' || cancel_reason FROM public.bookings WHERE id = '${id}'`)).toBe("cancelled|expired");
});

test("My Bookings shows expired holds as EXPIRED and played sessions as COMPLETED", async ({ page }) => {
  const yesterday = sql("SELECT ((now() AT TIME ZONE 'Asia/Manila')::date - 1)::text");
  seed("E2E Customer Expired", "11:00", "12:00", "cancelled", "'expired'", "now() - interval '1 hour'", "failed", { role: "CUSTOMER2" });
  seed("E2E Customer Played", "11:00", "12:00", "completed", "NULL", "NULL", "paid", { role: "CUSTOMER2", day: yesterday });
  seed("E2E Customer Cancelled", "12:00", "13:00", "cancelled", "'customer'", "NULL", "failed", { role: "CUSTOMER2" });

  await login(page, account("CUSTOMER2"));
  await page.goto("/my-bookings");
  await page.getByRole("button", { name: /Past Sessions/ }).click();
  await expect(page.getByText("EXPIRED", { exact: true })).toHaveCount(1);
  await expect(page.getByText("COMPLETED", { exact: true })).toHaveCount(1);
  await expect(page.getByText("CANCELLED", { exact: true })).toHaveCount(1);
});
