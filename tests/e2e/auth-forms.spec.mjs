// Read-only: no account is created; only a sign-in attempt for an address that does not exist.
import { test, expect } from "@playwright/test";

test.describe("login", () => {
  test("rejects unknown credentials without leaving the page", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email Address").fill("e2e-no-such-user@example.com");
    await page.getByLabel("Password", { exact: true }).fill("wrong-password-123");
    await page.getByRole("button", { name: "Sign In to Account" }).click();
    await expect(page.getByText("Sign In Failed")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("password visibility toggle", async ({ page }) => {
    await page.goto("/login");
    const password = page.getByLabel("Password", { exact: true });
    await expect(password).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: "Show password" }).click();
    await expect(password).toHaveAttribute("type", "text");
  });

  test("links to register and forgot password", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: "Forgot password?" }).click();
    await expect(page).toHaveURL(/\/forgot-password$/);
    await page.goto("/login");
    await page.getByRole("link", { name: "Create Account" }).click();
    await expect(page).toHaveURL(/\/register$/);
  });
});

test("auth pages have a heading, their own title and the way back home", async ({ page }) => {
  const pages = {
    "/login": ["Sign In", "Sign In | Crosshair Dinkers"],
    "/register": ["Create Player Account", "Create Account | Crosshair Dinkers"],
    "/forgot-password": ["Reset Password", "Reset Password | Crosshair Dinkers"],
    "/reset-password": ["Choose a New Password", "Choose a New Password | Crosshair Dinkers"],
  };
  for (const [path, [heading, title]] of Object.entries(pages)) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page).toHaveTitle(title);
    await expect(page.getByRole("link", { name: "Back to Courts" })).toBeVisible();
  }
});

test.describe("register validation", () => {
  async function fill(page, { password, confirm, phone }) {
    await page.goto("/register");
    await page.locator("#fullName").fill("E2E Player");
    await page.locator("#phone").fill(phone);
    await page.locator("#email").fill("e2e-validation@example.com");
    await page.locator("#password").fill(password);
    await page.locator("#confirmPassword").fill(confirm);
    await page.getByRole("button", { name: "Create Player Account" }).click();
  }

  test("short password", async ({ page }) => {
    await fill(page, { password: "123", confirm: "123", phone: "09171234567" });
    await expect(page.getByText(/Password is too short/)).toBeVisible();
  });

  test("mismatched passwords", async ({ page }) => {
    await fill(page, { password: "secret123", confirm: "secret124", phone: "09171234567" });
    await expect(page.getByText(/Passwords do not match/)).toBeVisible();
  });

  test("phone must be 11 digits", async ({ page }) => {
    await fill(page, { password: "secret123", confirm: "secret123", phone: "0917123" });
    // The input's pattern blocks submit natively, before the form's own JS check
    expect(await page.locator("#phone").evaluate((el) => el.validity.patternMismatch)).toBe(true);
    await expect(page).toHaveURL(/\/register$/);
  });
});
