// Screens that update by themselves when a booking or payment changes (Supabase realtime). Local Supabase stack only.
import { test, expect } from "@playwright/test";
import { writesAllowed, requireLocalDb, sql, account, login, resetBookings, firstCourt } from "./local-db.mjs";

test.describe.configure({ mode: "serial" });
test.beforeEach(() => { if (writesAllowed) resetBookings(); });
test.afterAll(() => { if (writesAllowed) resetBookings(); });

const today = () => sql("SELECT (now() AT TIME ZONE 'Asia/Manila')::date::text");
const customerId = () => sql(`SELECT id FROM public.profiles WHERE email = '${account("CUSTOMER").email}'`);

// A GCash booking whose screenshot staff haven't checked yet, made by someone else while the page is open
const insertAwaitingGcash = (date, name) => {
  const id = sql(`INSERT INTO public.bookings (user_id, court_id, booking_date, start_time, end_time, status, total_amount, customer_name, hold_expires_at)
    VALUES ('${customerId()}', '${firstCourt().id}', '${date}', '23:00', '23:59', 'pending', 300, '${name}', 'infinity') RETURNING id`).split(/\s+/)[0];
  sql(`INSERT INTO public.payments (booking_id, amount, currency, status, payment_method, payment_reference, gcash_submitted_at)
    VALUES ('${id}', 300, 'php', 'pending', 'gcash', 'RT123', now())`);
  return id;
};

test("the bookings table shows a booking made elsewhere without a reload", async ({ page }) => {
  requireLocalDb();
  await login(page, account("ADMIN"));
  await page.goto("/admin/bookings");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  insertAwaitingGcash(today(), "E2E Realtime Table");
  await expect(page.getByText("E2E Realtime Table").first()).toBeVisible();
});
