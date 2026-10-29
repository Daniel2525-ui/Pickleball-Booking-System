// Read-only: browses the live grid as a guest; never creates a hold.
import { test, expect } from "@playwright/test";

test("guest picking an open slot is sent to login @mobile", async ({ page }) => {
  await page.goto("/#booking");
  const grid = page.locator("#booking");
  const open = grid.getByRole("button", { name: /^Select .+ at / });
  // Wait for the grid to finish loading; today may have no open slot (closed, late, or fully booked).
  await expect(grid.locator('[aria-label*=" at "]').first().or(grid.getByText(/venue is closed/))).toBeVisible();
  test.skip((await open.count()) === 0, "no open slot today on the live grid");

  await open.first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Login Required")).toBeVisible();
  await dialog.getByRole("button", { name: "Go to Login" }).click();
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
