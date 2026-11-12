// The owner's discount codes and the players-per-court setting. Local Supabase stack only.
import { test, expect } from "@playwright/test";
import { writesAllowed, requireLocalDb, sql, account, login } from "./local-db.mjs";

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1280, height: 900 } });

test.beforeAll(() => {
  if (!writesAllowed) return;
  sql("UPDATE public.bookings SET discount_code_id = NULL WHERE discount_code_id IS NOT NULL; DELETE FROM public.discount_codes;");
});
test.afterAll(() => {
  if (!writesAllowed) return;
  sql("UPDATE public.bookings SET discount_code_id = NULL WHERE discount_code_id IS NOT NULL; DELETE FROM public.discount_codes; UPDATE public.booking_settings SET max_players_per_court = 8;");
});
test.beforeEach(() => requireLocalDb());

test("the owner creates a code, switches it off and edits it", async ({ page }) => {
  await login(page, account("ADMIN"));
  await page.goto("/admin/discounts", { waitUntil: "load" });
  await expect(page.getByRole("heading", { name: "Discount codes" })).toBeVisible();

  // Bad input is explained, nothing saved
  await page.getByLabel("Code").fill("x");
  await page.getByRole("button", { name: "Create code" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /./ })).toContainText("3 to 20");

  await page.getByLabel("Code").fill("summer15");
  await page.getByLabel("Percent off").fill("15");
  await page.getByLabel("Most uses (optional)").fill("20");
  await page.getByRole("button", { name: "Create code" }).click();
  const row = page.getByRole("row", { name: /SUMMER15/ });
  await expect(row).toContainText("15% off");
  await expect(row).toContainText("0 / 20");
  expect(sql("SELECT kind || '|' || value || '|' || max_uses || '|' || active FROM public.discount_codes WHERE code = 'SUMMER15'")).toBe("percent|15.00|20|true");

  // The same code twice is refused
  await page.getByLabel("Code").fill("SUMMER15");
  await page.getByLabel("Percent off").fill("5");
  await page.getByRole("button", { name: "Create code" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /./ })).toContainText("already a code SUMMER15");

  await row.getByRole("switch").click();
  await expect.poll(() => sql("SELECT active FROM public.discount_codes WHERE code = 'SUMMER15'")).toBe("f");

  await row.getByRole("button", { name: "Edit SUMMER15" }).click();
  await page.getByLabel("Ends (optional)").fill("2026-12-31");
  await page.getByRole("button", { name: "Save code" }).click();
  await expect(row).toContainText("Until");
  expect(sql("SELECT ends_on || '|' || active FROM public.discount_codes WHERE code = 'SUMMER15'")).toBe("2026-12-31|false");
});

test("front-desk staff can't open the discount codes", async ({ page }) => {
  test.skip(!process.env.E2E_STAFF_EMAIL, "needs a front-desk staff account (E2E_STAFF_EMAIL)");
  await login(page, account("STAFF"));
  const res = await page.request.get("/api/admin/discounts");
  expect(res.status()).toBe(403);
});

test("the owner sets the most players per court", async ({ page }) => {
  await login(page, account("ADMIN"));
  await page.goto("/admin/settings", { waitUntil: "load" });
  await page.getByLabel("Most players per court").fill("6");
  await page.getByRole("button", { name: "Save booking rules" }).click();
  await expect.poll(() => sql("SELECT max_players_per_court FROM public.booking_settings")).toBe("6");
  await page.getByLabel("Most players per court").fill("31");
  await page.getByRole("button", { name: "Save booking rules" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /./ })).toContainText("1 to 30");
});
