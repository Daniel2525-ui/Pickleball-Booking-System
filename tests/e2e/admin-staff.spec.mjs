// Owner and front-desk access: front desk runs the day but can't touch Pricing or Settings, even directly;
// owners manage who has which access. Local Supabase stack only.
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { writesAllowed, requireLocalDb, sql, account, login, localSupabase, resetBookings, firstCourt, tomorrowManila, openAllBookings } from "./local-db.mjs";

test.describe.configure({ mode: "serial" });

const access = (who) => sql(`SELECT role || '|' || is_owner FROM public.profiles WHERE email = '${account(who).email}'`);
const reset = () => {
  sql(`UPDATE public.profiles SET role = 'customer', is_owner = false WHERE email IN ('${account("CUSTOMER").email}', '${account("CUSTOMER2").email}')`);
  sql(`UPDATE public.profiles SET role = 'admin', is_owner = true WHERE email = '${account("ADMIN").email}'`);
};
const makeFrontDesk = () => sql(`UPDATE public.profiles SET role = 'admin', is_owner = false WHERE email = '${account("CUSTOMER2").email}'`);

async function signedIn(who) {
  const { url, anonKey } = localSupabase();
  const client = createClient(url, anonKey);
  const { error } = await client.auth.signInWithPassword(account(who));
  if (error) throw error;
  return client;
}

test.beforeAll(() => { if (writesAllowed) { reset(); resetBookings(); } });
test.afterAll(() => { if (writesAllowed) { reset(); resetBookings(); } });
test.beforeEach(() => requireLocalDb());

test("the owner gives an account front-desk access", async ({ page }) => {
  const email = account("CUSTOMER2").email;
  await login(page, account("ADMIN"));
  // The admin's pages say Admin
  await expect(page.getByRole("heading", { name: "Admin Dashboard" })).toBeVisible();
  await expect(page.getByText("Court Admin")).toBeVisible();
  await page.goto("/admin/settings");

  await page.getByLabel("Give staff access").fill("nobody-here@example.com");
  await page.getByRole("button", { name: "Give access" }).click();
  await expect(page.getByText("No player account uses that email. Ask them to sign up on the booking site first.")).toBeVisible();

  await page.getByLabel("Give staff access").fill(email);
  await page.getByRole("button", { name: "Give access" }).click(); // Front desk is the default
  await expect(page.getByText(/now has front desk access/)).toBeVisible();
  expect(access("CUSTOMER2")).toBe("admin|false");
  await expect(page.getByText(`${email}: given front desk access`).first()).toBeVisible();
});

test("front desk runs the day but never sees Pricing or Settings", async ({ page }) => {
  makeFrontDesk();
  await login(page, account("CUSTOMER2"));
  await expect(page).toHaveURL(/\/admin\/dashboard$/);
  // Front desk pages say Staff
  await expect(page.getByRole("heading", { name: "Staff Dashboard" })).toBeVisible();
  await expect(page.getByText("Court Staff")).toBeVisible();
  await expect(page.getByRole("link", { name: "Bookings", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Pricing", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Settings", exact: true })).toHaveCount(0);

  await page.goto("/");
  await expect(page.getByRole("link", { name: "Staff panel" }).first()).toBeVisible();

  for (const path of ["/admin/pricing", "/admin/settings"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/admin\/dashboard$/);
  }
  const res = await page.request.post("/api/admin/pricing", { data: { base_hourly_rate: 1, min_hours: 1, max_hours: 3, peak_rates: [] } });
  expect(res.status()).toBe(403);

  // A day's work still goes through: record a cash walk-in
  const court = firstCourt();
  await openAllBookings(page);
  await page.getByRole("button", { name: "New Reservation" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "New Walk-In" }).click();
  await dialog.getByLabel("Full Name").fill("E2E Front Desk Walk-in");
  await dialog.getByLabel("Assigned Court").click();
  await page.getByRole("option", { name: court.name }).click();
  await dialog.getByLabel("Reservation Date").fill(tomorrowManila());
  await dialog.getByLabel("Start Time").fill("10:00");
  await dialog.getByLabel("End Time").fill("11:00");
  await dialog.getByRole("button", { name: "Cash (Paid)", exact: true }).click();
  await dialog.getByRole("button", { name: "Record Reservation" }).click();
  await expect(page.getByText("Reservation recorded successfully!")).toBeVisible();
});

test("front desk can't change prices, payment details or staff access, even by calling the database", async () => {
  makeFrontDesk();
  const desk = await signedIn("CUSTOMER2");
  const before = sql("SELECT base_hourly_rate || '|' || coalesce(gcash_number, '-') FROM public.booking_settings");

  const { data: updated } = await desk.from("booking_settings").update({ gcash_number: "09990000000", gcash_account_name: "Thief" }).eq("id", true).select("id");
  expect(updated ?? []).toEqual([]);
  expect((await desk.rpc("save_pricing_settings", { p_base_hourly_rate: 1, p_min_hours: 1, p_max_hours: 3, p_peak_rates: [] })).error?.message).toContain("FORBIDDEN");
  const me = sql(`SELECT id FROM public.profiles WHERE email = '${account("CUSTOMER2").email}'`);
  expect((await desk.rpc("set_staff_access", { p_user_id: me, p_access: "owner" })).error?.message).toContain("FORBIDDEN");
  const upload = await desk.storage.from("club-assets").upload(`gcash-qr-${Date.now()}.png`, new Blob(["x"], { type: "image/png" }), { contentType: "image/png" });
  expect(upload.error).not.toBeNull();
  expect((await desk.from("settings_changes").select("id")).data).toEqual([]);

  expect(sql("SELECT base_hourly_rate || '|' || coalesce(gcash_number, '-') FROM public.booking_settings")).toBe(before);
  expect(access("CUSTOMER2")).toBe("admin|false");
});

test("the owner switches access levels and removes access; nobody changes their own", async ({ page, browser }) => {
  makeFrontDesk();
  const email = account("CUSTOMER2").email;
  await login(page, account("ADMIN"));
  await page.goto("/admin/settings");

  await page.getByLabel(`Access for ${email}`, { exact: true }).selectOption("owner");
  await expect(page.getByText(/now has admin access/)).toBeVisible();
  expect(access("CUSTOMER2")).toBe("admin|true");

  const other = await browser.newPage();
  await login(other, account("CUSTOMER2"));
  await other.goto("/admin/settings");
  await expect(other).toHaveURL(/\/admin\/settings$/);

  await page.getByRole("button", { name: `Remove staff access for ${email}` }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove Access" }).click();
  await expect(page.getByText(/no longer has staff access/)).toBeVisible();
  expect(access("CUSTOMER2")).toBe("customer|false");
  await other.goto("/admin/bookings");
  await expect(other).toHaveURL(/\/$/);
  await other.close();

  // The owner's own row has no controls, and the database refuses a change to one's own access
  await expect(page.getByLabel(`Access for ${account("ADMIN").email}`, { exact: true })).toHaveCount(0);
  const owner = await signedIn("ADMIN");
  const ownerId = sql(`SELECT id FROM public.profiles WHERE email = '${account("ADMIN").email}'`);
  expect((await owner.rpc("set_staff_access", { p_user_id: ownerId, p_access: "staff" })).error?.message).toContain("CANNOT_CHANGE_SELF");
  expect(access("ADMIN")).toBe("admin|true");
});

test("a player can't give themselves access", async () => {
  const player = await signedIn("CUSTOMER");
  const me = sql(`SELECT id FROM public.profiles WHERE email = '${account("CUSTOMER").email}'`);
  expect((await player.rpc("set_staff_access", { p_user_id: me, p_access: "owner" })).error?.message).toContain("FORBIDDEN");
  await player.from("profiles").update({ role: "admin", is_owner: true }).eq("id", me);
  expect(access("CUSTOMER")).toBe("customer|false");
});
