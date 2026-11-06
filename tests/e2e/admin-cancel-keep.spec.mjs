// Cancelling a paid booking: staff choose refund or keep the payment (case by case). Local Supabase stack only.
import { test, expect } from "@playwright/test";
import { writesAllowed, requireLocalDb, sql, account, login, tomorrowManila, resetBookings, firstCourt, openAllBookings } from "./local-db.mjs";

test.describe.configure({ mode: "serial" });

const date = tomorrowManila();
const ids = {};

function book(name, start, end) {
  const userId = sql(`SELECT id FROM public.profiles WHERE email = '${account("CUSTOMER").email}'`);
  const id = sql(`INSERT INTO public.bookings (user_id, court_id, booking_date, start_time, end_time, status, total_amount, customer_name)
    VALUES ('${userId}', '${firstCourt().id}', '${date}', '${start}', '${end}', 'confirmed', 200, '${name}') RETURNING id`).split(/\s+/)[0];
  ids[name] = sql(`INSERT INTO public.payments (booking_id, amount, currency, status, payment_method, paid_at)
    VALUES ('${id}', 200, 'php', 'paid', 'cash', now()) RETURNING id`).split(/\s+/)[0];
  ids[`${name} booking`] = id;
}

test.beforeAll(() => {
  if (!writesAllowed) return;
  resetBookings();
  book("E2E Refund Me", "10:00", "11:00");
  book("E2E Keep Me", "12:00", "13:00");
});
test.afterAll(() => { if (writesAllowed) resetBookings(); });
test.beforeEach(() => requireLocalDb());

async function cancel(page, name, keepNote) {
  await page.getByRole("row").filter({ hasText: name }).getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("menuitem", { name: "Cancel Reservation" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Cancel this paid reservation?")).toBeVisible();
  // The policy is non-refundable, so the dialog starts on "keep"; a refund is an explicit choice
  if (keepNote === undefined) await dialog.getByLabel(/Cancel and refund/).check();
  else {
    if (keepNote === "") {
      await dialog.getByRole("button", { name: "Cancel Reservation" }).click();
      await expect(dialog.getByRole("alert")).toHaveText("Write a short reason for keeping the payment.");
      return dialog;
    }
    await dialog.getByLabel("Reason for keeping the payment").fill(keepNote);
  }
  await dialog.getByRole("button", { name: "Cancel Reservation" }).click();
  await expect(dialog).toHaveCount(0);
  return dialog;
}

test("staff cancel one paid booking with a refund and keep another's payment", async ({ page }) => {
  await login(page, account("ADMIN"));
  await openAllBookings(page);

  await cancel(page, "E2E Refund Me");
  await expect.poll(() => sql(`SELECT status || '|' || cancel_reason FROM public.bookings WHERE id = '${ids["E2E Refund Me booking"]}'`)).toBe("cancelled|admin");

  // Keeping the payment needs a reason
  const dialog = await cancel(page, "E2E Keep Me", "");
  await dialog.getByLabel("Reason for keeping the payment").fill("Late cancellation, no refund");
  await dialog.getByRole("button", { name: "Cancel Reservation" }).click();
  await expect(page.getByText("Reservation cancelled. The payment was kept.")).toBeVisible();
  expect(sql(`SELECT status || '|' || cancel_reason || '|' || cancel_note FROM public.bookings WHERE id = '${ids["E2E Keep Me booking"]}'`))
    .toBe("cancelled|payment_kept|Late cancellation, no refund");
  expect(sql(`SELECT status FROM public.payments WHERE id = '${ids["E2E Keep Me"]}'`)).toBe("paid");
});

test("only the refunded one is owed back; both still count as collected today", async ({ page }) => {
  await login(page, account("ADMIN"));
  await expect(page.getByRole("link", { name: /1 payment needs a refund/ })).toBeVisible();

  await page.goto(`/admin/payments?status=${encodeURIComponent("Refund Owed")}`);
  const ref = (name) => `Ref ${ids[`${name} booking`].slice(0, 6).toUpperCase()}`;
  await expect(page.getByRole("row").filter({ hasText: ref("E2E Refund Me") })).toHaveCount(1);
  await expect(page.getByRole("row").filter({ hasText: ref("E2E Keep Me") })).toHaveCount(0);

  await page.goto("/admin/payments");
  await expect(page.locator('[data-slot="card"]').filter({ has: page.getByText("Collected", { exact: true }) }).getByText("₱400.00")).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: ref("E2E Keep Me") }).getByRole("button", { name: "Refund" })).toHaveCount(0);

  // The refund route refuses a kept payment even when asked directly
  const res = await page.request.post("/api/admin/payments/refund", { data: { paymentId: ids["E2E Keep Me"], receiptReference: "X1" } });
  expect(res.status()).toBe(409);
  expect((await res.json()).error).toBe("This payment was kept when the booking was cancelled, so it is not owed back.");
});

test("the history and the player's card say the payment was kept", async ({ page }) => {
  await login(page, account("ADMIN"));
  await openAllBookings(page);
  await page.getByRole("row").filter({ hasText: "E2E Keep Me" }).getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("menuitem", { name: "History" }).click();
  await expect(page.getByRole("dialog").getByRole("listitem").last()).toContainText("Cancelled by E2E Admin");
  await expect(page.getByRole("dialog").getByRole("listitem").last()).toContainText("payment kept: Late cancellation, no refund");

  await page.context().clearCookies();
  await login(page, account("CUSTOMER"));
  await page.goto("/my-bookings");
  await page.getByRole("button", { name: /Past Sessions/ }).click();
  await expect(page.getByText("Cancelled by the venue · Payment kept under the venue's cancellation policy")).toBeVisible();
});
