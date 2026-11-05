// Staff refund a cancelled cash booking at the counter: the payment is marked refunded, the handover is recorded,
// and it leaves Refund Owed. Local Supabase stack only.
import { test, expect } from "@playwright/test";
import { writesAllowed, requireLocalDb, sql, account, login, tomorrowManila, resetBookings, firstCourt } from "./local-db.mjs";

let paymentId;
let bookingId;

test.beforeAll(() => {
  if (!writesAllowed) return;
  resetBookings();
  const userId = sql(`SELECT id FROM public.profiles WHERE email = '${account("CUSTOMER").email}'`);
  bookingId = sql(`INSERT INTO public.bookings (user_id, court_id, booking_date, start_time, end_time, status, cancel_reason, total_amount, customer_name)
    VALUES ('${userId}', '${firstCourt().id}', '${tomorrowManila()}', '10:00', '11:00', 'cancelled', 'admin', 200, 'E2E Cash Refund') RETURNING id`).split(/\s+/)[0];
  paymentId = sql(`INSERT INTO public.payments (booking_id, amount, currency, status, payment_method, paid_at)
    VALUES ('${bookingId}', 200, 'php', 'paid', 'cash', now()) RETURNING id`).split(/\s+/)[0];
});
test.afterAll(() => { if (writesAllowed) resetBookings(); });
test.beforeEach(() => requireLocalDb());

test("staff refund a cash payment with a receipt number, and it leaves Refund Owed", async ({ page }) => {
  await login(page, account("ADMIN"));
  await page.goto(`/admin/payments?status=${encodeURIComponent("Refund Owed")}`);
  const row = page.getByRole("row").filter({ hasText: `Ref ${bookingId.slice(0, 6).toUpperCase()}` });
  await row.getByRole("button", { name: "Refund" }).click();

  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Receipt / Voucher Number").fill("RCPT-0042");
  await dialog.getByRole("button", { name: "Refund ₱200" }).click();
  await expect(page.getByText(/₱200 refunded to/)).toBeVisible();

  expect(sql(`SELECT status FROM public.payments WHERE id = '${paymentId}'`)).toBe("refunded");
  // The handover is recorded with its receipt number and the staff member who confirmed it
  expect(sql(`SELECT r.status || '|' || r.receipt_reference || '|' || p.email FROM public.refund_requests r
              JOIN public.profiles p ON p.id = r.confirmed_by WHERE r.payment_id = '${paymentId}'`))
    .toBe(`cash_refunded|RCPT-0042|${account("ADMIN").email}`);

  await page.reload();
  await expect(row).toHaveCount(0);
  // A second refund of the same payment is refused
  const again = await page.request.post("/api/admin/payments/refund", { data: { paymentId, receiptReference: "RCPT-0043" } });
  expect(again.status()).toBe(409);
});
