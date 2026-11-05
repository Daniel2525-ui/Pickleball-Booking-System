// Courts page: today's now / next line and closing a court for maintenance. Local Supabase stack only.
import { test, expect } from "@playwright/test";
import { writesAllowed, requireLocalDb, sql, account, login, tomorrowManila, resetBookings, firstCourt } from "./local-db.mjs";

test.describe.configure({ mode: "serial" });

let court;
const date = tomorrowManila();

test.beforeAll(() => {
  if (!writesAllowed) return;
  court = firstCourt();
});
test.beforeEach(() => {
  requireLocalDb();
  resetBookings();
});
test.afterAll(() => { if (writesAllowed) resetBookings(); });

const cardFor = (page, name) =>
  page.locator('[data-slot="card"]').filter({ has: page.getByRole("heading", { name, exact: true }) });

// A confirmed, paid booking on the court for the member account (phone 09170000001)
function book(name, day, startSql, endSql) {
  const userId = sql(`SELECT id FROM public.profiles WHERE email = '${account("CUSTOMER").email}'`);
  const id = sql(`INSERT INTO public.bookings (user_id, court_id, booking_date, start_time, end_time, status, total_amount, customer_name)
    VALUES ('${userId}', '${court.id}', ${day}, ${startSql}, ${endSql}, 'confirmed', 200, '${name}') RETURNING id`).split(/\s+/)[0];
  sql(`INSERT INTO public.payments (booking_id, amount, currency, status) VALUES ('${id}', 200, 'php', 'paid')`);
}

test("each court card shows who is playing now and who is next today", async ({ page }) => {
  const hour = Number(sql("SELECT extract(hour FROM now() AT TIME ZONE 'Asia/Manila')"));
  test.skip(hour < 1 || hour >= 21, "the seeded slots would cross midnight");
  const local = "(now() AT TIME ZONE 'Asia/Manila')";
  book("E2E Playing Now", `${local}::date`, `(${local} - interval '30 minutes')::time`, `(${local} + interval '30 minutes')::time`);
  book("E2E Up Next", `${local}::date`, `(${local} + interval '1 hour')::time`, `(${local} + interval '2 hours')::time`);

  await login(page, account("ADMIN"));
  await page.goto("/admin/courts");
  const card = cardFor(page, court.name);
  await expect(card.getByText(/Now:\s*E2E Playing Now until/)).toBeVisible();
  await expect(card.getByText(/Next:.*E2E Up Next/)).toBeVisible();
  await expect(card.getByText("Occupied")).toBeVisible();
  await expect(cardFor(page, "COURT 4").getByText("No more bookings today")).toBeVisible();
});

test("closing a court lists its upcoming bookings, and the card shows the reason and return date", async ({ page }) => {
  book("E2E Court Player", `'${date}'`, "'15:00'", "'16:00'");
  const back = sql("SELECT ((now() AT TIME ZONE 'Asia/Manila')::date + 3)::text");

  await login(page, account("ADMIN"));
  await page.goto("/admin/courts");
  await cardFor(page, court.name).getByRole("button", { name: `Actions for ${court.name}` }).click();
  await page.getByRole("menuitem", { name: "Edit Court" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Operational Status").click();
  await page.getByRole("option", { name: /Maintenance/ }).click();

  const warning = dialog.getByRole("status");
  await expect(warning.getByText("1 upcoming booking stays on this court")).toBeVisible();
  await expect(warning.getByText("E2E Court Player")).toBeVisible();
  await expect(warning.getByRole("link", { name: "09170000001" })).toHaveAttribute("href", "tel:09170000001");

  await dialog.getByLabel("Reason (optional)").fill("Net repair");
  await dialog.getByLabel("Back on (optional)").fill(back);
  await dialog.getByRole("button", { name: "Save Changes" }).click();
  await expect(dialog).toHaveCount(0);

  const shortBack = new Date(`${back}T12:00:00+08:00`).toLocaleDateString("en-US", { timeZone: "Asia/Manila", weekday: "short", month: "short", day: "numeric" });
  await expect(cardFor(page, court.name).getByText(`Net repair · back ${shortBack}`)).toBeVisible();
  expect(sql(`SELECT status || '|' || maintenance_note || '|' || maintenance_until FROM public.courts WHERE id = '${court.id}'`)).toBe(`maintenance|Net repair|${back}`);
  // Saving left the booking untouched
  expect(sql(`SELECT status FROM public.bookings WHERE customer_name = 'E2E Court Player'`)).toBe("confirmed");

  // The warning links to that court's bookings across every date
  await cardFor(page, court.name).getByRole("button", { name: `Actions for ${court.name}` }).click();
  await page.getByRole("menuitem", { name: "Edit Court" }).click();
  await dialog.getByRole("link", { name: "Open these in Bookings" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/bookings\\?court=${court.id}`));
  await expect(page.getByRole("row").filter({ hasText: "E2E Court Player" })).toHaveCount(1);
});

test("reopening a court clears its maintenance reason", async ({ page }) => {
  sql(`UPDATE public.courts SET status = 'maintenance', maintenance_note = 'Net repair' WHERE id = '${court.id}'`);
  await login(page, account("ADMIN"));
  await page.goto("/admin/courts");
  await cardFor(page, court.name).getByRole("button", { name: `Actions for ${court.name}` }).click();
  await page.getByRole("menuitem", { name: "Edit Court" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Operational Status").click();
  await page.getByRole("option", { name: /Available/ }).click();
  await dialog.getByRole("button", { name: "Save Changes" }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => sql(`SELECT status || '|' || coalesce(maintenance_note, 'none') FROM public.courts WHERE id = '${court.id}'`)).toBe("active|none");
});
