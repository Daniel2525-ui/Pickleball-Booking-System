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
  sql(`DELETE FROM public.auth_rate_limits WHERE key LIKE 'login:fail:${email}:%'`);
  for (let i = 0; i < 5; i++) {
    await tryLogin(page, email, "wrong-password");
    await expect(page.getByText("Invalid email or password. Please try again.")).toBeVisible();
  }
  await tryLogin(page, email, password);
  await expect(page.getByText(/Too many failed sign-in attempts for this account\. Please try again in 15 minutes\./)).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);

  // After the window, the correct password works again (and a success clears the failures)
  sql(`UPDATE public.auth_rate_limits SET window_start = now() - interval '16 minutes' WHERE key LIKE 'login:fail:${email}:%'`);
  await tryLogin(page, email, password);
  await expect(page).not.toHaveURL(/\/login/);
  expect(sql(`SELECT count(*) FROM public.auth_rate_limits WHERE key LIKE 'login:fail:${email}:%'`)).toBe("0");
});

test("wrong passwords from someone else's network do not lock the owner out of their own", async ({ request }) => {
  const { email, password } = account("CUSTOMER2");
  sql(`DELETE FROM public.auth_rate_limits WHERE key LIKE 'login:fail:${email}:%'`);
  const login = (pw, ip) => request.post("/api/auth/login", { data: { email, password: pw }, headers: { "x-forwarded-for": ip } });
  for (let i = 0; i < 5; i++) expect((await login("wrong-password", "203.0.113.9")).status()).toBe(401);
  expect((await login(password, "203.0.113.9")).status(), "the guesser's network is locked").toBe(429);
  expect((await login(password, "198.51.100.7")).status(), "the owner's network still signs in").toBe(200);
  sql(`DELETE FROM public.auth_rate_limits WHERE key LIKE 'login:fail:${email}:%'`);
});

test("the right password on an unconfirmed email says to confirm, and is not counted as a failure", async ({ page }) => {
  const { email, password } = account("CUSTOMER2");
  sql(`DELETE FROM public.auth_rate_limits WHERE key LIKE 'login:fail:${email}:%'`);
  const confirmedAt = sql(`SELECT email_confirmed_at FROM auth.users WHERE email = '${email}'`);
  sql(`UPDATE auth.users SET email_confirmed_at = NULL WHERE email = '${email}'`);
  try {
    await tryLogin(page, email, password);
    await expect(page.getByText("Please confirm your email first. Check your inbox (and spam) for the email from Crosshair Dinkers.")).toBeVisible();
    expect(sql(`SELECT count(*) FROM public.auth_rate_limits WHERE key LIKE 'login:fail:${email}:%'`)).toBe("0");

    // A player whose first email never arrived can ask for another
    sql(`DELETE FROM public.auth_rate_limits WHERE key = 'confirm:email:${email}'`);
    sql(`UPDATE auth.users SET confirmation_sent_at = now() - interval '1 hour' WHERE email = '${email}'`);
    await page.getByRole("button", { name: "Resend confirmation email" }).click();
    await expect(page.getByRole("status").filter({ hasText: `We sent a new confirmation email to ${email}.` })).toBeVisible();
    expect(sql(`SELECT confirmation_sent_at > now() - interval '1 minute' FROM auth.users WHERE email = '${email}'`)).toBe("t");
  } finally {
    sql(`DELETE FROM public.auth_rate_limits WHERE key = 'confirm:email:${email}'`);
    sql(`UPDATE auth.users SET email_confirmed_at = '${confirmedAt}' WHERE email = '${email}'`);
  }
});

test("the sign-up email's link lands on sign-in with a confirmed notice", async ({ page }) => {
  await page.goto("/login?confirmed=true");
  await expect(page.getByText("Email confirmed!")).toBeVisible();
});

test("sign-ups from one network are capped at 30 per hour (enough for a busy night on the venue's Wi-Fi)", async ({ request }) => {
  const signUp = (n) => request.post("/api/auth/register", {
    data: { email: `e2e-limit-${Date.now()}-${n}@example.com`, password: "secret123", fullName: "Limit Tester", phone: "09170000099" },
  });
  sql("DELETE FROM public.auth_rate_limits WHERE key LIKE 'signup:ip:%'");
  expect((await signUp(1)).status()).toBe(200);
  // Stand in for 28 more sign-ups from the same network this hour
  sql("UPDATE public.auth_rate_limits SET count = 29 WHERE key LIKE 'signup:ip:%'");
  expect((await signUp(30)).status(), "the 30th sign-up").toBe(200);
  const blocked = await signUp(31);
  expect(blocked.status()).toBe(429);
  expect(Number(blocked.headers()["retry-after"])).toBeGreaterThan(0);
  expect((await blocked.json()).error).toMatch(/Too many sign-ups from this network/);
  sql("DELETE FROM public.auth_rate_limits WHERE key LIKE 'signup:ip:%'");
});
