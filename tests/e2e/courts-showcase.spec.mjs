// The landing page's "Our courts" section: live status per court for guests. Local Supabase stack only.
import { test, expect } from "@playwright/test";
import { writesAllowed, requireLocalDb, sql, account, resetBookings } from "./local-db.mjs";

test.describe.configure({ mode: "serial" });

const today = () => sql("SELECT (now() AT TIME ZONE 'Asia/Manila')::date::text");
const weekday = () => sql("SELECT trim(to_char(now() AT TIME ZONE 'Asia/Manila', 'Day'))");
const courts = () => sql("SELECT id || '|' || name FROM public.courts ORDER BY name LIMIT 2").split(/\r?\n/).map((r) => { const [id, name] = r.split("|"); return { id, name }; });
let savedHours;

test.beforeAll(() => {
  if (!writesAllowed) return;
  resetBookings();
  savedHours = sql(`SELECT is_open || '|' || coalesce(open_time::text, '') || '|' || coalesce(close_time::text, '') FROM public.operating_hours WHERE day_of_week = '${weekday()}'`);
  sql(`UPDATE public.operating_hours SET is_open = true, open_time = '08:00', close_time = '22:00' WHERE day_of_week = '${weekday()}'`);
  const [first, second] = courts();
  const user = sql(`SELECT id FROM public.profiles WHERE email = '${account("CUSTOMER").email}'`);
  sql(`INSERT INTO public.bookings (user_id, court_id, booking_date, start_time, end_time, status, total_amount, customer_name)
    VALUES ('${user}', '${first.id}', '${today()}', '10:00', '11:00', 'confirmed', 300, 'E2E Showcase')`);
  sql(`UPDATE public.courts SET status = 'maintenance', maintenance_note = 'Resurfacing' WHERE id = '${second.id}'`);
});
test.afterAll(() => {
  if (!writesAllowed) return;
  resetBookings();
  const [, second] = courts();
  sql(`UPDATE public.courts SET status = 'active', maintenance_note = NULL WHERE id = '${second.id}'`);
  const [open, from, to] = savedHours.split("|");
  sql(`UPDATE public.operating_hours SET is_open = ${open === "t"}, open_time = ${from ? `'${from}'` : "NULL"}, close_time = ${to ? `'${to}'` : "NULL"} WHERE day_of_week = '${weekday()}'`);
});

test("guests see every court with its status and can switch the featured court", async ({ page }) => {
  requireLocalDb();
  const [first, second] = courts();
  // The browser's clock reads 10:35 AM today, inside the 10–11 AM booking on the first court
  await page.clock.setFixedTime(new Date(`${today()}T10:35:00+08:00`));
  await page.goto("/");

  const section = page.getByRole("region", { name: "Our courts" });
  const row = (name) => section.getByRole("button", { name: new RegExp(`^${name}\\b`) });
  const featured = section.getByRole("group", { name: "Featured court" });
  await expect(row(first.name)).toContainText("In play");
  await expect(row(second.name)).toContainText("Maintenance");

  await row(second.name).click();
  await expect(featured).toContainText(second.name);
  await expect(featured).toContainText("Resurfacing");
  await expect(featured.getByRole("link")).toHaveCount(0);

  await row(first.name).click();
  await expect(featured).toContainText("Free from 11:00 AM");
  await expect(featured.getByRole("link", { name: `Book ${first.name}` })).toHaveAttribute("href", "/book");
});

test("the Courts link in the navbar scrolls to the section", async ({ page }) => {
  await page.goto("/open-play");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Courts" }).click();
  await expect(page).toHaveURL(/\/#courts$/);
  await expect(page.getByRole("heading", { name: "Our courts" })).toBeInViewport();
});
