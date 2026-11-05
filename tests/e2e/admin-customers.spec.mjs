// Customer directory: members and walk-ins with history, staff left out, server search, edit, link to bookings.
// Local Supabase stack only.
import { test, expect } from "@playwright/test";
import { writesAllowed, requireLocalDb, sql, account, login, resetBookings, firstCourt } from "./local-db.mjs";

test.describe.configure({ mode: "serial" });

let regularId;

test.beforeAll(() => {
  if (!writesAllowed) return;
  resetBookings();
  const court = firstCourt();
  // The regular is the oldest walk-in record; 101 newer ones push it past the first page
  regularId = sql(`INSERT INTO public.customers (full_name, phone, created_at)
    VALUES ('E2E Walk Regular', '09181112222', now() - interval '30 days') RETURNING id`).split(/\s+/)[0];
  sql(`INSERT INTO public.customers (full_name, phone)
       SELECT 'E2E Filler ' || g, '0919' || lpad(g::text, 7, '0') FROM generate_series(1, 101) g`);
  const visits = [
    ["- 10", "completed"],
    ["- 7", "completed"],
    ["- 5", "no_show"],
    ["- 3", "no_show"],
    ["- 2", "cancelled"],
  ];
  visits.forEach(([days, status], i) => {
    const id = sql(`INSERT INTO public.bookings (customer_id, court_id, booking_date, start_time, end_time, status, total_amount, customer_name)
      VALUES ('${regularId}', '${court.id}', (now() AT TIME ZONE 'Asia/Manila')::date ${days}, '${8 + i}:00', '${9 + i}:00', '${status}', 200, 'E2E Walk Regular')
      RETURNING id`).split(/\s+/)[0];
    sql(`INSERT INTO public.payments (booking_id, amount, currency, status, payment_method, paid_at)
         VALUES ('${id}', 200, 'php', '${status === "cancelled" ? "refunded" : "paid"}', 'cash', now())`);
  });
});
test.afterAll(() => { if (writesAllowed) resetBookings(); });
test.beforeEach(() => requireLocalDb());

const rowFor = (page, name) => page.getByRole("row").filter({ hasText: name });

test("the directory lists members and walk-ins with their history, never staff", async ({ page }) => {
  await login(page, account("ADMIN"));
  await page.goto("/admin/customers");

  const expected = sql(`SELECT count(*) FROM public.profiles WHERE coalesce(role, '') <> 'admin'`) * 1 + 102;
  await expect(page.locator('[data-slot="card"]').filter({ hasText: "Total Customers" }).getByText(String(expected), { exact: true })).toBeVisible();
  // Staff accounts are not customers, even when searched for
  const search = page.getByLabel("Search customers by name, email, or phone");
  await search.fill("e2e-");
  await expect(rowFor(page, "e2e-customer@example.com").getByText("Member")).toBeVisible();
  await expect(rowFor(page, "e2e-admin@example.com")).toHaveCount(0);

  // The regular is past the first 100 rows: server search still finds it
  await search.fill("Walk Regular");
  const row = rowFor(page, "E2E Walk Regular");
  await expect(row).toHaveCount(1);
  await expect(row.getByText("Walk-in")).toBeVisible();
  const cells = row.getByRole("cell");
  await expect(cells.nth(2)).toHaveText("4"); // completed + no-shows; the cancelled one is not a booking that went ahead
  await expect(cells.nth(4)).toHaveText("2"); // two no-shows, highlighted
  await expect(cells.nth(5)).toHaveText("₱800"); // paid money; the refunded payment is left out
  const lastVisit = sql("SELECT to_char((now() AT TIME ZONE 'Asia/Manila')::date - 7, 'Mon FMDD, YYYY')");
  await expect(cells.nth(3)).toHaveText(lastVisit);
  await expect(row.getByRole("link", { name: "09181112222" })).toHaveAttribute("href", "tel:09181112222");
});

test("staff fix a walk-in's phone number; members can't be edited here", async ({ page }) => {
  await login(page, account("ADMIN"));
  await page.goto("/admin/customers");
  await page.getByLabel("Search customers by name, email, or phone").fill("e2e-customer@example.com");
  await page.getByRole("button", { name: "Actions for E2E Customer", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Edit details" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.getByLabel("Search customers by name, email, or phone").fill("Walk Regular");
  await page.getByRole("button", { name: "Actions for E2E Walk Regular" }).click();
  await page.getByRole("menuitem", { name: "Edit details" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Mobile number").fill("09181113333");
  await dialog.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.getByText("Customer details updated.")).toBeVisible();
  expect(sql(`SELECT phone FROM public.customers WHERE id = '${regularId}'`)).toBe("09181113333");
  await expect(rowFor(page, "E2E Walk Regular").getByRole("link", { name: "09181113333" })).toBeVisible();
});

test("View bookings opens that customer's bookings across every date", async ({ page }) => {
  await login(page, account("ADMIN"));
  await page.goto("/admin/customers");
  await page.getByLabel("Search customers by name, email, or phone").fill("Walk Regular");
  await page.getByRole("button", { name: "Actions for E2E Walk Regular" }).click();
  await page.getByRole("menuitem", { name: "View bookings" }).click();
  await expect(page).toHaveURL(/\/admin\/bookings\?search=09181113333/);
  await expect(page.getByLabel("Filter by booking date")).toHaveValue("");
  await expect(page.getByRole("row").filter({ hasText: "E2E Walk Regular" })).toHaveCount(5); // every booking, cancelled one included
});
