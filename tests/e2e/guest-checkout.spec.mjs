// Guest checkout (no account), number of players and discount codes. Local Supabase stack only, with anonymous
// sign-ins switched on (Supabase Auth: "Allow anonymous sign-ins").
import { test, expect } from "@playwright/test";
import { writesAllowed, requireLocalDb, sql, tomorrowManila, resetBookings, pickDay } from "./local-db.mjs";

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1280, height: 900 } });

const day = tomorrowManila();
const guestEmail = `guest-${Date.now()}@example.com`;

test.beforeAll(() => {
  if (!writesAllowed) return;
  resetBookings();
  sql(`DELETE FROM public.discount_codes;
       UPDATE public.booking_settings SET max_players_per_court = 4;
       INSERT INTO public.discount_codes (code, kind, value) VALUES ('TEST10', 'percent', 10), ('SHUT', 'fixed', 50);
       UPDATE public.discount_codes SET active = false WHERE code = 'SHUT';`);
});
test.afterAll(() => {
  if (!writesAllowed) return;
  resetBookings();
  sql(`DELETE FROM public.discount_codes; UPDATE public.booking_settings SET max_players_per_court = 8;`);
});
test.beforeEach(() => requireLocalDb());

const grid = (page) => page.locator("#booking");
const slot = (page, court, time) => grid(page).getByRole("button", { name: `Select ${court} at ${time}` }).filter({ visible: true });
const dialog = (page) => page.getByRole("dialog");

async function openCheckout(page) {
  await page.goto("/#booking", { waitUntil: "load" });
  await pickDay(page, 1);
  await slot(page, "COURT 1", "6:00 PM - 7:00 PM").click();
  await page.getByRole("region", { name: "Your selection" }).getByRole("button", { name: "Continue to Checkout" }).click();
  await expect(dialog(page).getByRole("heading", { name: "Review and pay" })).toBeVisible();
}

test("a guest checks out with a details form, a player count and a code, without an account", async ({ page }) => {
  await openCheckout(page);
  await expect(dialog(page).getByText("No account needed.")).toBeVisible();

  // Details are checked before anything is held
  await dialog(page).getByRole("button", { name: /^Pay ₱/ }).click();
  await expect(dialog(page).getByRole("alert")).toContainText("full name");

  await dialog(page).getByLabel("Full name").fill("Gina Guest");
  await dialog(page).getByLabel("Mobile number").fill("0917 123 4567");
  await dialog(page).getByLabel("Email").fill(guestEmail);

  // Players are typed: blank and over the venue's limit (4 for one court here) are refused on Pay
  await expect(dialog(page).getByText("Up to 4")).toBeVisible();
  await dialog(page).getByRole("button", { name: /^Pay ₱/ }).click();
  await expect(dialog(page).getByRole("alert")).toContainText("Enter the number of players.");
  await dialog(page).getByLabel("Number of players").fill("5");
  await dialog(page).getByRole("button", { name: /^Pay ₱/ }).click();
  await expect(dialog(page).getByRole("alert")).toContainText("at most 4 players");
  await dialog(page).getByLabel("Number of players").fill("3");

  // Codes: switched off, unknown, then a good one
  await dialog(page).getByRole("textbox", { name: "Discount code" }).fill("shut");
  await dialog(page).getByRole("button", { name: "Apply" }).click();
  await expect(dialog(page).getByText("This code is switched off.")).toBeVisible();
  await dialog(page).getByRole("textbox", { name: "Discount code" }).fill("nope");
  await dialog(page).getByRole("button", { name: "Apply" }).click();
  await expect(dialog(page).getByText("There is no such code.")).toBeVisible();
  await dialog(page).getByRole("textbox", { name: "Discount code" }).fill("test10");
  await dialog(page).getByRole("button", { name: "Apply" }).click();
  await expect(dialog(page).getByText("−₱20")).toBeVisible();
  await expect(dialog(page).getByRole("button", { name: "Pay ₱180 with QR Ph" })).toBeVisible();

  await dialog(page).getByRole("button", { name: "Pay ₱180 with QR Ph" }).click();
  if (!process.env.XENDIT_SECRET_KEY) {
    // Without QR Ph the holds are made, then released: proof the guest, players and code reached the database
    await expect(dialog(page).getByRole("alert")).toBeVisible({ timeout: 30_000 });
  } else {
    await page.waitForURL(/\/book\/qr\?pr=/, { timeout: 30_000 });
  }
  expect(
    sql(`SELECT p.is_guest || '|' || p.full_name || '|' || p.phone || '|' || p.email || '|' || b.player_count || '|' || b.total_amount || '|' || b.discount_amount || '|' || pay.amount
         FROM public.bookings b JOIN public.profiles p ON p.id = b.user_id JOIN public.payments pay ON pay.booking_id = b.id
         WHERE b.booking_date = '${day}' AND b.start_time = '18:00' ORDER BY b.created_at DESC LIMIT 1`)
  ).toBe(`true|Gina Guest|09171234567|${guestEmail}|3|180.00|20.00|180.00`);

  // The header knows them as a guest
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /Account menu/ }).first().click();
  await expect(page.getByText("Guest · no account yet")).toBeVisible();
});

test("a guest creates an account afterwards and keeps the booking", async ({ page }) => {
  await openCheckout(page);
  await dialog(page).getByLabel("Full name").fill("Carla Convert");
  await dialog(page).getByLabel("Mobile number").fill("09181234567");
  const email = `convert-${Date.now()}@example.com`;
  await dialog(page).getByLabel("Email").fill(email);
  await dialog(page).getByRole("button", { name: /^Pay ₱/ }).click();
  await expect(dialog(page).getByRole("alert").or(page.getByText(/QR/)).first()).toBeVisible({ timeout: 30_000 });
  const guestId = sql(`SELECT id FROM public.profiles WHERE full_name = 'Carla Convert' AND is_guest`);
  expect(guestId).not.toBe("");

  // Too many players straight at the API, on the guest's own session: refused with the limit
  const courtId = sql("SELECT id FROM public.courts WHERE name = 'COURT 2'");
  const tooMany = await page.request.post("/api/stripe/checkout", {
    data: { booking_date: day, player_count: 5, guest: { full_name: "Carla Convert", phone: "09181234567", email },
            lines: [{ court_id: courtId, start_time: "20:00", end_time: "21:00" }] },
  });
  expect(tooMany.status()).toBe(400);
  expect((await tooMany.json()).error).toMatch(/at most 4 players/);
  const noDetails = await page.request.post("/api/stripe/checkout", {
    data: { booking_date: day, player_count: 2, lines: [{ court_id: courtId, start_time: "20:00", end_time: "21:00" }] },
  });
  expect(noDetails.status()).toBe(400);

  // Open play is for accounts
  const openPlay = await page.request.post("/api/open-play/book", { data: { session_id: "00000000-0000-0000-0000-000000000000", spots: 1 } });
  expect(openPlay.status()).toBe(401);

  await page.keyboard.press("Escape");
  await page.goto("/register");
  await page.locator("#fullName").fill("Carla Convert");
  await page.locator("#phone").fill("09181234567");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill("guest-pass-123");
  await page.locator("#confirmPassword").fill("guest-pass-123");
  await page.locator('button[type="submit"]').click();
  await expect(page).not.toHaveURL(/\/register/, { timeout: 30_000 });

  // Same user, now a normal account, bookings kept
  expect(sql(`SELECT is_guest || '|' || email FROM public.profiles WHERE id = '${guestId}'`)).toBe(`false|${email}`);
  expect(Number(sql(`SELECT count(*) FROM public.bookings WHERE user_id = '${guestId}'`))).toBeGreaterThan(0);
});

test("a guest can choose to create an account instead, and an email in use is not revealed", async ({ page }) => {
  await openCheckout(page);
  await dialog(page).getByRole("button", { name: "create one" }).click();
  await expect(page).toHaveURL(/\/register$/);
  expect(await page.evaluate(() => sessionStorage.getItem("crosshair:pending-basket"))).toContain('"lines"');

  // On a guest session, an email that already has an account gets a neutral answer
  await openCheckout(page);
  await dialog(page).getByLabel("Full name").fill("Nora Neutral");
  await dialog(page).getByLabel("Mobile number").fill("09191234567");
  await dialog(page).getByLabel("Email").fill(`nora-${Date.now()}@example.com`);
  await dialog(page).getByRole("button", { name: /^Pay ₱/ }).click();
  await expect(dialog(page).getByRole("alert").or(page.getByText(/QR/)).first()).toBeVisible({ timeout: 30_000 });
  const res = await page.request.post("/api/auth/register", {
    data: { email: process.env.E2E_CUSTOMER_EMAIL, password: "whatever-123", fullName: "Nora Neutral", phone: "09191234567" },
  });
  expect(res.status()).toBe(400);
  expect((await res.json()).error).toBe("We couldn't use that email. If you already have an account, sign in instead.");
});

test("signing out as a guest asks first, since the bookings can't be shown again", async ({ page }) => {
  await openCheckout(page);
  await dialog(page).getByLabel("Full name").fill("Sam Signout");
  await dialog(page).getByLabel("Mobile number").fill("09201234567");
  await dialog(page).getByLabel("Email").fill(`sam-${Date.now()}@example.com`);
  await dialog(page).getByRole("button", { name: /^Pay ₱/ }).click();
  await expect(dialog(page).getByRole("alert").or(page.getByText(/QR/)).first()).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press("Escape");

  const menu = page.getByRole("button", { name: /Account menu/ }).first();
  await menu.click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByRole("alertdialog").or(page.getByRole("dialog")).getByText("Sign out of your guest bookings?")).toBeVisible();
  await page.getByRole("button", { name: "Stay signed in" }).click();
  // Still the same guest
  await menu.click();
  await expect(page.getByText("Guest · no account yet").first()).toBeVisible();
});
