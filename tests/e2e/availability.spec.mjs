// Read-only: browses the live grid as a guest; never creates a hold.
import { test, expect } from "@playwright/test";

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

test("the day strip follows the chosen date past the first week", async ({ page }) => {
  await page.goto("/#booking", { waitUntil: "load" });
  const strip = page.getByRole("button", { pressed: true }).filter({ hasText: /Today|Tmrw|Mon|Tue|Wed|Thu|Fri|Sat|Sun/ });
  await expect(strip).toHaveText(/Today/);
  // Ten days ahead, one tap at a time: the strip moves along and still marks the chosen day
  for (let i = 0; i < 10; i++) await page.getByRole("button", { name: "Next day" }).click();
  const target = new Date(Date.now() + 10 * 86_400_000).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "Asia/Manila" });
  await expect(strip).toContainText(target);
  // And back to the first week, where Today is again first
  for (let i = 0; i < 10; i++) await page.getByRole("button", { name: "Previous day" }).click();
  await expect(strip).toHaveText(/Today/);
});
