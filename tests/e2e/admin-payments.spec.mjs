// Payments page as an end-of-day view: method per row, today's totals by method, server search. Local Supabase stack only.
import { test, expect } from "@playwright/test";
import { writesAllowed, requireLocalDb, sql, account, login, resetBookings, firstCourt } from "./local-db.mjs";

test.describe.configure({ mode: "serial" });

const ids = {};
let today;

// A booking plus its payment; `paidAt` is SQL for when the money came in (NULL while unpaid)
function seed(name, start, bookingStatus, payment) {
  const court = firstCourt();
  const userId = sql(`SELECT id FROM public.profiles WHERE email = '${account("CUSTOMER").email}'`);
  const id = sql(`INSERT INTO public.bookings (user_id, court_id, booking_date, start_time, end_time, status, total_amount, customer_name)
    VALUES ('${userId}', '${court.id}', ${payment.day ?? "(now() AT TIME ZONE 'Asia/Manila')::date"}, '${start}', '${start.replace(/^(\d\d)/, (h) => String(Number(h) + 1).padStart(2, "0"))}', '${bookingStatus}', ${payment.amount}, '${name}')
    RETURNING id`).split(/\s+/)[0];
  sql(`INSERT INTO public.payments (booking_id, amount, currency, status, payment_method, payment_reference, paid_at, created_at)
    VALUES ('${id}', ${payment.amount}, 'php', '${payment.status}', ${payment.method ? `'${payment.method}'` : "NULL"}, ${payment.ref ? `'${payment.ref}'` : "NULL"},
            ${payment.paidAt ?? "now()"}, ${payment.createdAt ?? "now()"})`);
  ids[name] = id;
}

test.beforeAll(() => {
  if (!writesAllowed) return;
  resetBookings();
  today = sql("SELECT (now() AT TIME ZONE 'Asia/Manila')::date::text");
  seed("E2E Cash Player", "08:00", "confirmed", { amount: 200, status: "paid", method: "cash" });
  seed("E2E GCash Player", "09:00", "confirmed", { amount: 300, status: "paid", method: "gcash", ref: "GC-7741" });
  seed("E2E Card Player", "10:00", "confirmed", { amount: 400, status: "paid", method: "stripe" });
  seed("E2E Refunded Player", "11:00", "cancelled", { amount: 250, status: "refunded", method: "stripe" });
  seed("E2E Unpaid Player", "12:00", "confirmed", { amount: 150, status: "pending", paidAt: "NULL" });
  seed("E2E Yesterday Player", "13:00", "completed", {
    amount: 500, status: "paid", method: "cash",
    day: "(now() AT TIME ZONE 'Asia/Manila')::date - 1", paidAt: "now() - interval '1 day'", createdAt: "now() - interval '1 day'",
  });
});
test.beforeEach(() => requireLocalDb());
test.afterAll(() => { if (writesAllowed) resetBookings(); });

// The table shows the member profile name, so rows are told apart by booking ref
const rowFor = (page, name) => page.getByRole("row").filter({ hasText: `Ref ${ids[name].slice(0, 6).toUpperCase()}` });
const card = (page, title) => page.locator('[data-slot="card"]').filter({ has: page.getByText(title, { exact: true }) });

test("the page opens on today with the day's money split by method", async ({ page }) => {
  await login(page, account("ADMIN"));
  await page.goto("/admin/payments");
  await expect(page.getByLabel("Filter by payment date")).toHaveValue(today);

  await expect(card(page, "Collected").getByText("₱900.00")).toBeVisible();
  await expect(card(page, "QR Ph").getByText("₱700.00")).toBeVisible();
  await expect(card(page, "Refunded").getByText("₱250.00")).toBeVisible();

  await expect(rowFor(page, "E2E Cash Player").getByText("Cash", { exact: true })).toBeVisible();
  await expect(rowFor(page, "E2E GCash Player").getByText("QR Ph", { exact: true })).toBeVisible();
  await expect(rowFor(page, "E2E Card Player").getByText("QR Ph", { exact: true })).toBeVisible();
  await expect(rowFor(page, "E2E Unpaid Player").getByText("Not paid yet")).toBeVisible();
  await expect(rowFor(page, "E2E Cash Player").getByText(`Ref ${ids["E2E Cash Player"].slice(0, 6).toUpperCase()}`)).toBeVisible();
  await expect(rowFor(page, "E2E Yesterday Player")).toHaveCount(0);

  // Clearing the date shows every day; totals need a day
  await page.getByRole("button", { name: "Clear date filter" }).click();
  await expect(rowFor(page, "E2E Yesterday Player")).toHaveCount(1);
  await expect(card(page, "Cash").getByText("Pick a date to see totals")).toBeVisible();
});

test("search finds payments by GCash reference and booking reference on the server", async ({ page }) => {
  await login(page, account("ADMIN"));
  await page.goto("/admin/payments");
  const search = page.getByLabel("Search payment transactions");

  await search.fill("GC-7741");
  await expect(rowFor(page, "E2E GCash Player")).toHaveCount(1);
  await expect(rowFor(page, "E2E Cash Player")).toHaveCount(0);

  await search.fill(ids["E2E Cash Player"].slice(0, 6));
  await expect(rowFor(page, "E2E Cash Player")).toHaveCount(1);
  await expect(rowFor(page, "E2E GCash Player")).toHaveCount(0);

  // An older payment is found once the date filter is cleared
  await search.fill("E2E Yesterday");
  await expect(rowFor(page, "E2E Yesterday Player")).toHaveCount(0);
  await page.getByRole("button", { name: "Clear date filter" }).click();
  await expect(rowFor(page, "E2E Yesterday Player")).toHaveCount(1);
});
