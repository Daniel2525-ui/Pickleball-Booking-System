// One player's whole life through the UI, then the staff side: sign up, book, pay by GCash, staff verify,
// the player can't cancel a paid booking, so staff cancel and refund it. Local Supabase stack only.
import { test, expect } from "@playwright/test";
import { writesAllowed, requireLocalDb, sql, account, login, tomorrowManila, resetBookings, firstCourt, pickDay } from "./local-db.mjs";

test.describe.configure({ mode: "serial" });
// Desktop layout: the grid shows every court at once (phones show one court at a time)
test.use({ viewport: { width: 1280, height: 900 } });

const stamp = Date.now();
const player = { name: "Journey Player", phone: "09175550123", email: `e2e-journey-${stamp}@example.com`, password: "journey-pass-1" };
const date = tomorrowManila();
const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
let court;
let gcashBefore;
const problems = [];

test.beforeAll(() => {
  if (!writesAllowed) return;
  resetBookings();
  court = firstCourt();
  gcashBefore = sql("SELECT coalesce(gcash_account_name,'') || '|' || coalesce(gcash_number,'') FROM public.booking_settings");
  sql("UPDATE public.booking_settings SET gcash_account_name = 'Journey Venue', gcash_number = '09170000999'");
});
test.afterAll(() => {
  if (!writesAllowed) return;
  resetBookings();
  const [name, num] = gcashBefore.split("|");
  sql(`UPDATE public.booking_settings SET gcash_account_name = ${name ? `'${name}'` : "NULL"}, gcash_number = ${num ? `'${num}'` : "NULL"}`);
  // Storage blocks SQL deletes; the uploaded receipt is a 1x1 test image left in the local bucket
  sql(`DELETE FROM public.profiles WHERE email = '${player.email}'; DELETE FROM auth.users WHERE email = '${player.email}'`);
  if (problems.length) console.log("JOURNEY CONSOLE PROBLEMS:\n" + problems.join("\n"));
});
test.beforeEach(({ page }) => {
  requireLocalDb();
  page.on("pageerror", (e) => problems.push(`[pageerror] ${page.url()} ${e.message.slice(0, 160)}`));
  page.on("console", (m) => { if (m.type() === "error") problems.push(`[console] ${page.url()} ${m.text().slice(0, 160)}`); });
});

const bookingState = () => sql(`SELECT b.status || '|' || coalesce(p.status, '') || '|' || coalesce(p.payment_method, '') || '|' || b.total_amount
  FROM public.bookings b JOIN public.profiles pr ON pr.id = b.user_id LEFT JOIN public.payments p ON p.booking_id = b.id
  WHERE pr.email = '${player.email}' ORDER BY b.created_at DESC LIMIT 1`);

test("1. a new player signs up through the site", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /Sign in/i }).first().click();
  await page.getByRole("link", { name: "Create Account" }).click();
  await page.getByLabel("Full Name").fill(player.name);
  await page.getByLabel("Mobile Number").fill(player.phone);
  await page.getByLabel("Email Address").fill(player.email);
  await page.getByLabel("Password", { exact: true }).fill(player.password);
  await page.getByLabel("Confirm Password", { exact: true }).fill(player.password);
  await page.getByRole("button", { name: "Create Player Account" }).click();
  // The local stack skips email confirmation, so sign-up signs the player straight in and /login sends them home
  await expect(page).not.toHaveURL(/\/register/);
  // The profile row the app relies on (name, phone, customer role) is created by the sign-up trigger
  expect(sql(`SELECT full_name || '|' || phone || '|' || role FROM public.profiles WHERE email = '${player.email}'`)).toBe(`${player.name}|${player.phone}|customer`);
  await page.context().clearCookies();
  await login(page, player);
});

test("2. the player books two hours tomorrow and pays by GCash", async ({ page }) => {
  await login(page, player);
  await page.goto("/#booking");
  await pickDay(page, 1);
  await page.locator("#booking").getByRole("button", { name: `Select ${court.name} at 3:00 PM - 4:00 PM` }).click();
  await page.getByRole("group", { name: new RegExp(`^${court.name} .+ selection line$`) }).getByRole("button", { name: "One hour longer" }).click();
  await expect(page.getByRole("region", { name: "Your selection" }).getByText("₱400", { exact: true }).last()).toBeVisible();
  await page.locator("#booking").getByRole("button", { name: "Continue to Checkout" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: "GCash" }).click();
  await dialog.getByRole("button", { name: "Continue to Checkout" }).click();

  await page.waitForURL(/\/book\/gcash/);
  await expect(page.getByText("09170000999")).toBeVisible();
  expect(bookingState()).toBe("pending|pending|gcash|400.00");
  await page.getByLabel("GCash reference number").fill("JRN123456");
  await page.getByLabel("Payment screenshot").setInputFiles({ name: "receipt.png", mimeType: "image/png", buffer: PNG_1X1 });
  await page.getByRole("button", { name: "Submit payment" }).click();
  await expect(page.getByText(/The staff will check your GCash payment/)).toBeVisible();

  await page.goto("/my-bookings");
  await expect(page.getByText(court.name).first()).toBeVisible();
});

test("3. staff verify the GCash payment and the booking is confirmed", async ({ page }) => {
  await login(page, account("ADMIN"));
  await page.goto("/admin/bookings");
  await page.getByRole("button", { name: "Clear date filter" }).click();
  const row = page.getByRole("row").filter({ hasText: player.name });
  await row.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("menuitem", { name: "Verify" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("JRN123456")).toBeVisible();
  await expect(dialog.getByText("₱400")).toBeVisible();
  await dialog.getByRole("button", { name: "Approve — mark paid" }).click();
  await expect(row.getByText("Confirmed")).toBeVisible();
  expect(bookingState()).toBe("confirmed|paid|gcash|400.00");

  // The new player is in the customer directory with their booking and spend
  await page.goto("/admin/customers");
  const customer = page.getByRole("row").filter({ hasText: player.email });
  await expect(customer).toBeVisible();
  await expect(customer.getByText("₱400")).toBeVisible();

  // Payments shows the GCash money
  await page.goto("/admin/payments");
  await page.getByRole("button", { name: /Clear date/i }).click().catch(() => {});
  await expect(page.getByRole("row").filter({ hasText: player.name }).first()).toBeVisible();
});

test("4. the player sees it confirmed and non-refundable; staff cancel it with a refund on request", async ({ page }) => {
  await login(page, player);
  await page.goto("/my-bookings");
  await expect(page.getByText(/confirmed/i).first()).toBeVisible();
  await expect(page.getByText(/Paid bookings are non-refundable/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel Reservation" })).toHaveCount(0);

  await page.context().clearCookies();
  await login(page, account("ADMIN"));
  await page.goto("/admin/bookings");
  await page.getByRole("button", { name: "Clear date filter" }).click();
  await page.getByRole("row").filter({ hasText: player.name }).getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("menuitem", { name: "Cancel Reservation" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/Cancel and refund/).check();
  await dialog.getByRole("button", { name: "Cancel Reservation" }).click();
  await expect.poll(() => bookingState().split("|")[0]).toBe("cancelled");
});

test("5. staff pay the GCash refund back and the player sees it", async ({ page }) => {
  await login(page, account("ADMIN"));
  await page.goto("/admin/payments");
  const row = page.getByRole("row").filter({ hasText: player.name });
  await row.getByRole("button", { name: "Refund" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("GCash reference of your refund transfer").fill("GCASHRF01");
  await dialog.getByRole("button", { name: "Refund ₱400" }).click();
  await expect(page.getByText(/₱400 refunded to/)).toBeVisible();
  expect(bookingState()).toBe("cancelled|refunded|gcash|400.00");

  await page.context().clearCookies();
  await login(page, player);
  await page.goto("/my-bookings");
  // Cancelled bookings move to the Past tab
  await page.getByRole("button", { name: /Past/ }).click();
  await expect(page.getByText(/refund/i).first()).toBeVisible();
});

test("6. staff record a paid walk-in and open the dashboard", async ({ page }) => {
  await login(page, account("ADMIN"));
  await page.goto("/admin/bookings");
  await page.getByRole("button", { name: "New Reservation" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "New Walk-In" }).click();
  await dialog.getByLabel("Full Name").fill("Journey Walk In");
  await dialog.getByLabel("Assigned Court").click();
  await page.getByRole("option", { name: court.name }).click();
  await dialog.getByLabel("Reservation Date").fill(date);
  await dialog.getByLabel("Start Time").fill("19:00");
  await dialog.getByLabel("End Time").fill("20:00");
  await dialog.getByRole("button", { name: "Cash (Paid)", exact: true }).click();
  await dialog.getByRole("button", { name: "Record Reservation" }).click();
  await expect(page.getByText("Reservation recorded successfully!")).toBeVisible();

  await page.goto("/admin/dashboard");
  await expect(page.getByRole("heading", { name: "Admin Dashboard" })).toBeVisible();
});
