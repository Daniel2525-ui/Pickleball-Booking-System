// Trips the sign-in and sign-up limits: local Supabase stack only.
import { test, expect } from "@playwright/test";
import { writesAllowed, requireLocalDb, sql, account } from "./local-db.mjs";

test.describe.configure({ mode: "serial" });
test.beforeEach(() => requireLocalDb());
test.afterAll(() => {
  if (!writesAllowed) return;
  sql("DELETE FROM public.auth_rate_limits; DELETE FROM auth.users WHERE email LIKE 'e2e-limit-%@example.com';");
});

const tryLogin = async (page, email, password) => {
  await page.goto("/login");
  await page.getByLabel("Email Address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign In to Account" }).click();
};

test("five wrong passwords lock that account's sign-in for 15 minutes, even with the right password", async ({ page }) => {
  const { email, password } = account("CUSTOMER2");
  sql(`DELETE FROM public.auth_rate_limits WHERE key = 'login:fail:${email}'`);
  for (let i = 0; i < 5; i++) {
    await tryLogin(page, email, "wrong-password");
    await expect(page.getByText("Invalid email or password. Please try again.")).toBeVisible();
  }
  await tryLogin(page, email, password);
  await expect(page.getByText(/Too many failed sign-in attempts for this account\. Please try again in 15 minutes\./)).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);

  // After the window, the correct password works again (and a success clears the failures)
  sql(`UPDATE public.auth_rate_limits SET window_start = now() - interval '16 minutes' WHERE key = 'login:fail:${email}'`);
  await tryLogin(page, email, password);
  await expect(page).not.toHaveURL(/\/login/);
  expect(sql(`SELECT count(*) FROM public.auth_rate_limits WHERE key = 'login:fail:${email}'`)).toBe("0");
});

test("the right password on an unconfirmed email says to confirm, and is not counted as a failure", async ({ page }) => {
  const { email, password } = account("CUSTOMER2");
  sql(`DELETE FROM public.auth_rate_limits WHERE key = 'login:fail:${email}'`);
  const confirmedAt = sql(`SELECT email_confirmed_at FROM auth.users WHERE email = '${email}'`);
  sql(`UPDATE auth.users SET email_confirmed_at = NULL WHERE email = '${email}'`);
  try {
    await tryLogin(page, email, password);
    await expect(page.getByText("Please confirm your email first. Check your inbox (and spam) for the email from Crosshair Dinkers.")).toBeVisible();
    expect(sql(`SELECT count(*) FROM public.auth_rate_limits WHERE key = 'login:fail:${email}'`)).toBe("0");
  } finally {
    sql(`UPDATE auth.users SET email_confirmed_at = '${confirmedAt}' WHERE email = '${email}'`);
  }
});

test("the sign-up email's link lands on sign-in with a confirmed notice", async ({ page }) => {
  await page.goto("/login?confirmed=true");
  await expect(page.getByText("Email confirmed!")).toBeVisible();
});

test("sign-ups from one network are capped at 10 per hour", async ({ request }) => {
  const signUp = (n) => request.post("/api/auth/register", {
    data: { email: `e2e-limit-${Date.now()}-${n}@example.com`, password: "secret123", fullName: "Limit Tester", phone: "09170000099" },
  });
  for (let n = 1; n <= 10; n++) expect((await signUp(n)).status(), `sign-up ${n}`).toBe(200);
  const blocked = await signUp(11);
  expect(blocked.status()).toBe(429);
  expect(Number(blocked.headers()["retry-after"])).toBeGreaterThan(0);
  expect((await blocked.json()).error).toMatch(/Too many sign-ups from this network/);
});
