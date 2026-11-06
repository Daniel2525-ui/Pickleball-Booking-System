// Read-only: browses the live grid as a guest; never creates a hold.
import { test, expect } from "@playwright/test";

test("guest can fill a basket and is asked to sign in only at checkout @mobile", async ({ page }) => {
  await page.goto("/#booking");
  const grid = page.locator("#booking");
  const open = grid.getByRole("button", { name: /^Select .+ at / });
  // Wait for the grid to finish loading; today may have no open slot (closed, late, or fully booked).
  await expect(
    grid.locator('[aria-label*=" at "]').first()
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
  await expect(dialog.getByText("Sign in to pay")).toBeVisible();
  // The basket is parked for after sign-in
  expect(await page.evaluate(() => sessionStorage.getItem("crosshair:pending-basket"))).toContain('"lines"');
  await dialog.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("pages fit a phone screen without horizontal scroll @mobile", async ({ page }) => {
  for (const path of ["/", "/login", "/register", "/forgot-password", "/my-bookings"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${path} overflows by ${overflow}px`).toBeLessThanOrEqual(0);
  }
});
