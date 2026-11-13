// Read-only: every request here is rejected before any data is touched.
import { test, expect } from "@playwright/test";

test.describe("unauthenticated page access", () => {
  for (const path of ["/admin/dashboard", "/admin/bookings", "/admin/courts", "/admin/customers", "/admin/payments", "/admin/schedules"]) {
    test(`${path} redirects to home`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/$/);
    });
  }

  test("/my-bookings asks the visitor to sign in", async ({ page }) => {
    await page.goto("/my-bookings");
    await expect(page.getByRole("heading", { name: "Sign In Required" })).toBeVisible();
    await page.getByRole("link", { name: "Sign In to View Reservations" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("/book/success without a checkout session goes to My Bookings", async ({ page }) => {
    await page.goto("/book/success");
    await expect(page).toHaveURL(/\/my-bookings$/);
  });

  test("/profile asks the visitor to sign in", async ({ page }) => {
    await page.goto("/profile");
    await expect(page.getByText("Sign in to view and edit your profile.")).toBeVisible();
  });

  test("privacy and terms pages are linked from sign-up and state that payments are non-refundable", async ({ page }) => {
    await page.goto("/register");
    await page.getByRole("link", { name: "Booking Rules" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Terms & Booking Rules" })).toBeVisible();
    await expect(page.getByText(/All payments are final and non-refundable/)).toBeVisible();
    await page.goto("/register");
    await page.getByRole("link", { name: "Privacy Policy" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Privacy Policy" })).toBeVisible();
  });

  test("/book is its own booking page and the home page has no grid", async ({ page }) => {
    await page.goto("/book");
    await expect(page.getByRole("button", { name: "Next month" })).toBeVisible();
    await page.goto("/");
    await expect(page.locator("#booking")).toHaveCount(0);
    await page.getByRole("link", { name: "Book a court" }).first().click();
    await expect(page).toHaveURL(/\/book$/);
  });
});

test.describe("unauthenticated API access", () => {
  const rejected = [
    ["GET", "/api/admin/customers", 401],
    ["POST", "/api/admin/customers", 401],
    ["POST", "/api/admin/bookings/status", 401],
    ["POST", "/api/admin/courts", 401],
    ["POST", "/api/admin/payments/refund", 401],
    ["POST", "/api/admin/payments/settle", 401],
    ["POST", "/api/admin/schedules", 401],
    ["POST", "/api/stripe/checkout", 401],
    ["POST", "/api/stripe/verify", 401],
    ["POST", "/api/bookings/cancel", 401],
    ["POST", "/api/bookings/resume-payment", 401],
    ["GET", "/api/bookings/status?bookingId=00000000-0000-0000-0000-000000000000", 401],
    ["GET", "/api/cron/cleanup-expired-bookings", 401],
  ];

  for (const [method, url, status] of rejected) {
    test(`${method} ${url} -> ${status}`, async ({ request }) => {
      const res = await request.fetch(url, { method, data: method === "POST" ? {} : undefined });
      expect(res.status()).toBe(status);
    });
  }

  test("cron route rejects a wrong bearer secret", async ({ request }) => {
    const res = await request.get("/api/cron/cleanup-expired-bookings", {
      headers: { Authorization: "Bearer not-the-secret" },
    });
    expect(res.status()).toBe(401);
  });

  test("Stripe webhook rejects missing and forged signatures", async ({ request }) => {
    const body = JSON.stringify({ type: "checkout.session.completed" });
    expect((await request.post("/api/stripe/webhook", { data: body })).status()).toBe(400);
    const forged = await request.post("/api/stripe/webhook", {
      data: body,
      headers: { "stripe-signature": "t=1,v1=deadbeef" },
    });
    expect(forged.status()).toBe(400);
  });
});
