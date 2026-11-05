// The Admin Reports page: what the owner sees, the CSV, and who can't get in. Local Supabase stack only.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { writesAllowed, requireLocalDb, sql, account, login, resetBookings, firstCourt } from "./local-db.mjs";

test.describe.configure({ mode: "serial" });

const customer = () => sql(`SELECT id FROM public.profiles WHERE email = '${account("CUSTOMER").email}'`);
function paidBooking(start, amount, method) {
  const court = firstCourt();
  const id = sql(`INSERT INTO public.bookings (user_id, court_id, booking_date, start_time, end_time, status, total_amount, customer_name)
    VALUES ('${customer()}', '${court.id}', '2026-09-10', '${start}', '${String(Number(start.slice(0, 2)) + 1).padStart(2, "0")}:00', 'completed', ${amount}, 'E2E Report Player') RETURNING id`).split(/\s+/)[0];
  sql(`INSERT INTO public.payments (booking_id, amount, currency, status, payment_method, paid_at) VALUES ('${id}', ${amount}, 'php', 'paid', '${method}', '2026-09-10 10:00:00+08')`);
}
const frontDesk = (on) => sql(`UPDATE public.profiles SET role = '${on ? "admin" : "customer"}', is_owner = false WHERE email = '${account("CUSTOMER2").email}'`);

test.beforeAll(() => {
  if (!writesAllowed) return;
  resetBookings();
  paidBooking("08:00", 400, "cash");
  paidBooking("09:00", 350, "gcash");
  paidBooking("10:00", 300, "stripe");
});
test.afterAll(() => { if (writesAllowed) { resetBookings(); frontDesk(false); } });
test.beforeEach(() => requireLocalDb());

async function openSeptember(page) {
  await login(page, account("ADMIN"));
  await page.getByRole("link", { name: "Reports", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/reports$/);
  await page.getByRole("button", { name: "Custom", exact: true }).click();
  await page.getByLabel("From", { exact: true }).fill("2026-09-01");
  await page.getByLabel("To", { exact: true }).fill("2026-09-30");
}

test("the owner opens Reports from the sidebar and sees the numbers", async ({ page }) => {
  await openSeptember(page);
  await expect(page.getByText("₱1,050").first()).toBeVisible();
  await expect(page.getByRole("group", { name: "Cash", exact: true })).toContainText("₱400");
  await expect(page.getByRole("row").filter({ hasText: "E2E Customer" }).first()).toBeVisible();
  await expect(page.getByLabel(/^Sep 10: ₱1,050$/)).toBeVisible();
});

test("CSV matches the screen", async ({ page }) => {
  await openSeptember(page);
  await expect(page.getByText("₱1,050").first()).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download CSV" }).click()]);
  expect(download.suggestedFilename()).toBe("reports-2026-09-01-to-2026-09-30.csv");
  const lines = readFileSync(await download.path(), "utf8").trim().split("\n");
  expect(lines[0]).toBe("Date,Bookings,Court hours,Cash,GCash,Card,Refunded,Net");
  expect(lines).toHaveLength(31);
  expect(lines.find((l) => l.startsWith("2026-09-10"))).toBe("2026-09-10,3,3,400,350,300,0,1050");
});

test("front desk and players can't open Reports", async ({ page }) => {
  frontDesk(true);
  try {
    await login(page, account("CUSTOMER2"));
    await expect(page).toHaveURL(/\/admin\/dashboard$/);
    await expect(page.getByRole("link", { name: "Reports", exact: true })).toHaveCount(0);
    await page.goto("/admin/reports");
    await expect(page).toHaveURL(/\/admin\/dashboard$/);
  } finally {
    frontDesk(false);
  }
  await page.context().clearCookies();
  await login(page, account("CUSTOMER"));
  await page.goto("/admin/reports");
  await expect(page).not.toHaveURL(/\/admin\/reports/);
});

test("an empty month says so", async ({ page }) => {
  await login(page, account("ADMIN"));
  await page.goto("/admin/reports");
  await page.getByRole("button", { name: "Custom", exact: true }).click();
  await page.getByLabel("From", { exact: true }).fill("2026-08-01");
  await page.getByLabel("To", { exact: true }).fill("2026-08-31");
  await expect(page.getByText("No money came in during this period.")).toBeVisible();
  await expect(page.getByText("₱0").first()).toBeVisible();
});

test("a custom range the wrong way round is refused", async ({ page }) => {
  await login(page, account("ADMIN"));
  await page.goto("/admin/reports");
  await page.getByRole("button", { name: "Custom", exact: true }).click();
  // A valid month first, so there is a report on screen
  await page.getByLabel("From", { exact: true }).fill("2026-09-01");
  await page.getByLabel("To", { exact: true }).fill("2026-09-30");
  await expect(page.getByText("₱1,050").first()).toBeVisible();
  // Then, in one step, an end before the start: the old figures go away and there is nothing to download
  await page.getByLabel("To", { exact: true }).fill("2026-08-01");
  await expect(page.getByText("Pick a start date on or before the end date.")).toBeVisible();
  await expect(page.getByText("₱1,050")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Download CSV" })).toBeDisabled();
  // Fixing the range brings a report back (the page isn't left loading)
  await page.getByLabel("To", { exact: true }).fill("2026-09-30");
  await expect(page.getByText("₱1,050").first()).toBeVisible();
});
