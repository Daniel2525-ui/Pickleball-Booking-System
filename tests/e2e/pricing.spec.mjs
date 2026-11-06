// Changes venue pricing and creates holds: local Supabase stack only.
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { writesAllowed, requireLocalDb, sql, account, login, tomorrowManila, resetBookings, firstCourt, localSupabase } from "./local-db.mjs";

test.describe.configure({ mode: "serial" });
// Phone width shows the quick-date strip ("Tmrw")
test.use({ viewport: { width: 412, height: 915 } });

let court;
const date = tomorrowManila();
const tomorrowDay = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));

test.beforeAll(() => {
  if (!writesAllowed) return;
  resetBookings();
  court = firstCourt();
});
test.afterAll(() => {
  if (writesAllowed) resetBookings(); // back to PHP 200 / 1-3 hours for the other specs
});
test.beforeEach(() => requireLocalDb());

test("admin sets a base rate, longer bookings and a peak window", async ({ page }) => {
  await login(page, account("ADMIN"));
  await page.goto("/admin/pricing");
  await page.getByLabel("Base rate (₱ per hour)").fill("250");
  await page.getByLabel("Maximum booking (hours)").fill("4");

  await page.getByRole("button", { name: "Add Peak Window" }).click();
  const peak = page.getByTestId("peak-window");
  await peak.getByLabel("Name").fill("Evening");
  await peak.getByLabel("From").selectOption("17:00");
  await peak.getByLabel("Until").selectOption("22:00");
  await peak.getByLabel("Rate (₱/hr)").fill("400");
  const dayButton = peak.getByRole("button", { name: tomorrowDay.slice(0, 3), exact: true });
  if ((await dayButton.getAttribute("aria-pressed")) !== "true") await dayButton.click();

  // The preview prices the unsaved form: 5 PM on that day is peak, 4 PM is base
  const preview = page.getByRole("table", { name: "Price per hour by day" });
  const dayCol = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].indexOf(tomorrowDay) + 1;
  await expect(preview.getByRole("row").filter({ hasText: /^5:00 PM/ }).getByRole("cell").nth(dayCol)).toHaveText("₱400");
  await expect(preview.getByRole("row").filter({ hasText: /^4:00 PM/ }).getByRole("cell").nth(dayCol)).toHaveText("₱250");

  // Saving shows what changes and waits for a confirmation
  await page.getByRole("button", { name: "Save Pricing" }).click();
  const confirm = page.getByRole("dialog");
  await expect(confirm).toContainText("Base rate: ₱200 → ₱250 per hour");
  await expect(confirm).toContainText("Booking length: 1–3 → 1–4 hours");
  await expect(confirm).toContainText("Peak window: Evening at ₱400/hr");
  await confirm.getByRole("button", { name: "Save Pricing" }).click();
  await expect(page.getByText("Pricing saved. New bookings use these rates.")).toBeVisible();
  expect(sql("SELECT base_hourly_rate || '|' || min_hours || '|' || max_hours FROM public.booking_settings")).toBe("250.00|1|4");
  expect(sql("SELECT label || '|' || start_time || '|' || end_time || '|' || hourly_rate FROM public.peak_rates")).toBe("Evening|17:00:00|22:00:00|400.00");


  // The save is recorded with who made it
  const latest = page.getByRole("listitem").filter({ hasText: "E2E Admin" }).first();
  await expect(latest).toContainText("Base rate: ₱200 → ₱250 per hour");
  await expect(latest).toContainText("Peak window: Evening at ₱400/hr");
});

test("customers can't read the price history", async () => {
  const { url, anonKey } = localSupabase();
  const client = createClient(url, anonKey);
  expect((await client.auth.signInWithPassword(account("CUSTOMER"))).error).toBeNull();
  const { data, error } = await client.from("pricing_changes").select("id");
  expect(error).toBeNull();
  expect(data).toEqual([]);
  expect(Number(sql("SELECT count(*) FROM public.pricing_changes"))).toBeGreaterThan(0);
});

test("admin sees a clear error for an impossible booking length, and nothing is saved", async ({ page }) => {
  await login(page, account("ADMIN"));
  await page.goto("/admin/pricing");
  await page.getByLabel("Minimum booking (hours)").fill("5");
  await page.getByLabel("Maximum booking (hours)").fill("2");
  await page.getByRole("button", { name: "Save Pricing" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Save Pricing" }).click();
  await expect(page.getByText(/minimum not above the maximum/)).toBeVisible();
  expect(sql("SELECT min_hours || '|' || max_hours FROM public.booking_settings")).toBe("1|4");
});

test("a peak window outside opening hours is flagged, and an unchanged form has nothing to save", async ({ page }) => {
  await login(page, account("ADMIN"));
  await page.goto("/admin/pricing");
  await page.getByRole("button", { name: "Save Pricing" }).click();
  await expect(page.getByText("Nothing has changed.")).toBeVisible();

  await page.getByRole("button", { name: "Add Peak Window" }).click();
  const late = page.getByTestId("peak-window").last();
  await late.getByLabel("From").selectOption("22:00"); // the test venue closes at 10 PM
  await late.getByLabel("Until").selectOption("23:00");
  await expect(late.getByText("This window is outside opening hours on every day it covers, so it never applies.")).toBeVisible();
});

test("customers see the configured prices, and the hold is charged what the database quotes", async ({ page }) => {
  await login(page, account("CUSTOMER"));
  await page.goto("/#booking");
  await page.getByRole("button", { name: /Tmrw/ }).click();
  await page.locator("#booking").getByRole("button", { name: `Select ${court.name} at 4:00 PM - 5:00 PM` }).click();

  // Grid cells show prices too, so read totals from the basket
  const panel = page.getByRole("region", { name: "Your selection" });
  await expect(panel.getByText("₱250", { exact: true }).last()).toBeVisible();
  await expect(panel.getByRole("button", { name: "One hour longer" })).toBeEnabled();
  await panel.getByRole("button", { name: "One hour longer" }).click();
  await expect(panel.getByText("₱650", { exact: true }).last()).toBeVisible(); // 4 PM base + 5 PM peak
  await expect(panel.getByText(/includes peak rate/)).toBeVisible();

  await panel.getByRole("button", { name: "Continue to Checkout" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Continue to Checkout" }).click();
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30_000 });
  expect(
    sql(`SELECT b.total_amount || '|' || p.amount FROM public.bookings b JOIN public.payments p ON p.booking_id = b.id
         WHERE b.booking_date = '${date}' AND b.start_time = '16:00'`)
  ).toBe("650.00|650.00");
});

test("the landing page and terms show the configured rates", async ({ page }) => {
  // Both pages refresh every 5 minutes in production; a fresh local build renders them on demand
  await page.goto("/terms");
  await expect(page.getByText(/standard court rate is ₱250 per hour/)).toBeVisible();
  await expect(page.getByText(/Evening: .*5:00 PM–10:00 PM at ₱400\/hr/)).toBeVisible();
  await expect(page.getByText(/1 to 4 consecutive hours/)).toBeVisible();
});
