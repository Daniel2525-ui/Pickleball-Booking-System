// Venue contact in Settings: saved details reach the pages players see. Local Supabase stack only.
import { test, expect } from "@playwright/test";
import { writesAllowed, requireLocalDb, sql, account, login } from "./local-db.mjs";

const restore = () =>
  sql("UPDATE public.booking_settings SET venue_phone = '+63 917 123 4567', venue_email = 'play@crosshairdinkers.com', venue_address = 'J.C. Aquino Ave, Butuan City'");

test.beforeEach(() => requireLocalDb());
test.afterAll(() => { if (writesAllowed) restore(); });

test("staff update the venue phone, and players see the new number", async ({ page }) => {
  restore();
  await login(page, account("ADMIN"));
  await page.goto("/admin/settings");
  const phone = page.getByLabel("Phone", { exact: true });

  await phone.fill("call us");
  await page.getByRole("button", { name: "Save contact details" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Enter a phone number players can call" })).toBeVisible();

  await phone.fill("(0918) 555-0199");
  await page.getByRole("button", { name: "Save contact details" }).click();
  await expect(page.getByText("Venue contact saved.")).toBeVisible();
  expect(sql("SELECT venue_phone FROM public.booking_settings")).toBe("(0918) 555-0199");
  await expect(page.getByText("venue phone: +63 917 123 4567 → (0918) 555-0199").first()).toBeVisible();

  await page.goto("/");
  await expect(page.getByRole("link", { name: "(0918) 555-0199" })).toHaveAttribute("href", "tel:09185550199");
});
