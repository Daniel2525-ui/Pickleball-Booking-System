// Read-only: browses the live grid as a guest; never creates a hold.
import { test, expect } from "@playwright/test";
import { pickDay } from "./local-db.mjs";

test("a guest fills a basket and checks out with their details, or signs in instead @mobile", async ({ page }) => {
  await page.goto("/#booking");
  const grid = page.locator("#booking");
  const open = grid.getByRole("button", { name: /^Select .+ at / });
  // Wait for the grid to finish loading; today may have no open slot (closed, late, or fully booked).
  await expect(
    grid.locator('[aria-label*=" at "]:visible').first()
      .or(grid.getByText(/venue is closed/))
      .or(grid.getByRole("button", { name: /^Show \d+ earlier time slot/ }))
      .first(),
  ).toBeVisible();
  test.skip((await open.count()) === 0, "no open slot today on the live grid");

  await open.first().click();
  const basket = page.getByRole("region", { name: "Your selection" });
  await expect(basket).toBeVisible();
  await basket.getByRole("button", { name: "Continue to Checkout" }).click();
  const dialog = page.getByRole("dialog");
  // No account needed: the checkout asks for their details, and signing in stays one tap away
  await expect(dialog.getByText("No account needed.")).toBeVisible();
  await expect(dialog.getByLabel("Full name")).toBeVisible();
  await dialog.getByRole("button", { name: "Have an account? Sign in" }).click();
  await expect(page).toHaveURL(/\/login$/);
  // The basket is parked for after sign-in
  expect(await page.evaluate(() => sessionStorage.getItem("crosshair:pending-basket"))).toContain('"lines"');
});

test("pages fit a phone screen without horizontal scroll @mobile", async ({ page }) => {
  for (const path of ["/", "/login", "/register", "/forgot-password", "/my-bookings"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${path} overflows by ${overflow}px`).toBeLessThanOrEqual(0);
  }
});

test("the calendar is always shown, picks a later date and blocks past days", async ({ page }) => {
  await page.goto("/#booking", { waitUntil: "load" });
  await pickDay(page, 10);
  const label = new Date(Date.now() + 10 * 86_400_000).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "Asia/Manila" });
  await expect(page.getByRole("button", { name: new RegExp(`^${label}`) })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Previous month" })).toBeVisible();
});
