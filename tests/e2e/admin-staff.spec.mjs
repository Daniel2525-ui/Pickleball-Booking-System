// Staff access from Settings: give and remove it, never lock the venue out, players can't promote themselves.
// Local Supabase stack only.
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { writesAllowed, requireLocalDb, sql, account, login, localSupabase } from "./local-db.mjs";

test.describe.configure({ mode: "serial" });

const role = (who) => sql(`SELECT role FROM public.profiles WHERE email = '${account(who).email}'`);
const demote = () => sql(`UPDATE public.profiles SET role = 'customer' WHERE email IN ('${account("CUSTOMER").email}', '${account("CUSTOMER2").email}')`);

async function signedIn(who) {
  const { url, anonKey } = localSupabase();
  const client = createClient(url, anonKey);
  const { error } = await client.auth.signInWithPassword(account(who));
  if (error) throw error;
  return client;
}

test.beforeAll(() => { if (writesAllowed) demote(); });
test.afterAll(() => { if (writesAllowed) demote(); });
test.beforeEach(() => requireLocalDb());

test("staff give a player account staff access, and can take it away again", async ({ page, browser }) => {
  const email = account("CUSTOMER2").email;
  await login(page, account("ADMIN"));
  await page.goto("/admin/settings");

  // Unknown email: nothing changes
  await page.getByLabel("Give staff access").fill("nobody-here@example.com");
  await page.getByRole("button", { name: "Give staff access" }).click();
  await expect(page.getByText("No player account uses that email. Ask them to sign up on the booking site first.")).toBeVisible();

  await page.getByLabel("Give staff access").fill(email);
  await page.getByRole("button", { name: "Give staff access" }).click();
  await expect(page.getByText(/now has staff access/)).toBeVisible();
  expect(role("CUSTOMER2")).toBe("admin");
  await expect(page.getByText(`${email}: given staff access`).first()).toBeVisible(); // newest first

  // They can open the admin pages now
  const other = await browser.newPage();
  await login(other, account("CUSTOMER2"));
  await other.goto("/admin/bookings");
  await expect(other).toHaveURL(/\/admin\/bookings/);

  // Remove access: asks first, then they are sent away from the admin pages
  await page.getByRole("button", { name: `Remove staff access for ${email}` }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove Access" }).click();
  await expect(page.getByText(/no longer has staff access/)).toBeVisible();
  expect(role("CUSTOMER2")).toBe("customer");
  await other.goto("/admin/bookings");
  await expect(other).toHaveURL(/\/$/);
  await other.close();
});

test("staff can't remove their own access, and the row has no Remove button for them", async ({ page }) => {
  await login(page, account("ADMIN"));
  await page.goto("/admin/settings");
  await expect(page.getByRole("listitem").filter({ hasText: "(you)" })).toBeVisible();
  await expect(page.getByRole("button", { name: `Remove staff access for ${account("ADMIN").email}` })).toHaveCount(0);

  const admin = await signedIn("ADMIN");
  const adminId = sql(`SELECT id FROM public.profiles WHERE email = '${account("ADMIN").email}'`);
  const { error } = await admin.rpc("set_staff_access", { p_user_id: adminId, p_is_staff: false });
  expect(error?.message).toContain("CANNOT_REMOVE_SELF");
  expect(role("ADMIN")).toBe("admin");
});

test("a player can't give themselves staff access", async () => {
  const player = await signedIn("CUSTOMER");
  const me = sql(`SELECT id FROM public.profiles WHERE email = '${account("CUSTOMER").email}'`);
  const { error } = await player.rpc("set_staff_access", { p_user_id: me, p_is_staff: true });
  expect(error?.message).toContain("FORBIDDEN");
  // Nor by editing their own profile row directly
  await player.from("profiles").update({ role: "admin" }).eq("id", me);
  expect(role("CUSTOMER")).toBe("customer");
});
