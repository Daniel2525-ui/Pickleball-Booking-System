// Multi-court basket: real holds, Stripe test-mode sessions, refunds and counter settlement. Local Supabase stack only.
import { test, expect } from "@playwright/test";
import { writesAllowed, requireLocalDb, sql, account, login, tomorrowManila, resetBookings, payOnStripe } from "./local-db.mjs";

test.describe.configure({ mode: "serial" });
// Phone width shows the quick-date strip ("Tmrw"), the simplest stable way to pick tomorrow
test.use({ viewport: { width: 412, height: 915 } });

const date = tomorrowManila();

test.beforeAll(() => {
  if (!writesAllowed) return;
  resetBookings();
});
test.beforeEach(() => requireLocalDb());

const courtId = (name) => sql(`SELECT id FROM public.courts WHERE name = '${name}'`);
const userId = (role) => sql(`SELECT id FROM public.profiles WHERE email = '${account(role).email}'`);
const basket = (page) => page.getByRole("region", { name: "Your basket" });
const basketLine = (page, court) => basket(page).getByRole("group", { name: `${court} basket line` });
const slot = (page, court, time) => page.locator("#booking").getByRole("button", { name: `Select ${court} at ${time}` });

async function openTomorrow(page) {
  await page.goto("/#booking");
  // The grid lives behind the quick picker's "full board" link
  await page.getByRole("button", { name: "See the full board" }).click();
  await page.getByRole("button", { name: /Tmrw/ }).click();
}

// lines: [courtName, "HH:MM", "HH:MM"][]
const checkout = (page, lines) =>
  page.request.post("/api/stripe/checkout", {
    data: { booking_date: date, lines: lines.map(([court, start_time, end_time]) => ({ court_id: courtId(court), start_time, end_time })) },
  });

// "<booking status>|<payment status>|<payment amount>" for one court's latest booking at a start time
const courtRow = (court, start) =>
  sql(`SELECT b.status || '|' || coalesce(p.status, '') || '|' || coalesce(p.amount::text, '') FROM public.bookings b
       LEFT JOIN public.payments p ON p.booking_id = b.id
       WHERE b.court_id = '${courtId(court)}' AND b.booking_date = '${date}' AND b.start_time = '${start}'
       ORDER BY b.created_at DESC LIMIT 1`);
const bookingId = (court, start) =>
  sql(`SELECT id FROM public.bookings WHERE court_id = '${courtId(court)}' AND booking_date = '${date}' AND start_time = '${start}' ORDER BY created_at DESC LIMIT 1`);

test("a two-court basket is paid in one Stripe checkout and confirms both courts", async ({ page }) => {
  await login(page, account("CUSTOMER"));
  await openTomorrow(page);
  for (const court of ["COURT 1", "COURT 2"]) {
    await slot(page, court, "6:00 PM - 7:00 PM").click();
    await basketLine(page, court).getByRole("button", { name: "2 hrs" }).click();
  }
  await expect(basket(page).getByText("Your basket · 2 courts")).toBeVisible();
  await expect(basket(page).getByText("₱800", { exact: true })).toBeVisible();
  await expect(basket(page).getByText("All courts are held together, or none.")).toBeVisible();

  await basket(page).getByRole("button", { name: "Continue to Checkout" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Continue to Checkout" }).click();
  await payOnStripe(page);
  await page.waitForURL(/\/book\/success\?session_id=/, { timeout: 60_000 });
  await expect(page.getByText("Confirmed & Paid")).toBeVisible({ timeout: 30_000 });

  expect(courtRow("COURT 1", "18:00")).toBe("confirmed|paid|400.00");
  expect(courtRow("COURT 2", "18:00")).toBe("confirmed|paid|400.00");
  // bookings | distinct Stripe sessions | distinct baskets
  expect(
    sql(`SELECT count(*) || '|' || count(DISTINCT p.stripe_session_id) || '|' || count(DISTINCT b.basket_id) FROM public.bookings b
         JOIN public.payments p ON p.booking_id = b.id
         WHERE b.booking_date = '${date}' AND b.start_time = '18:00' AND b.user_id = '${userId("CUSTOMER")}'`)
  ).toBe("2|1|1");
});

test("cancelling one paid court refunds only that court, and cannot be repeated", async ({ page }) => {
  await login(page, account("CUSTOMER"));
  const id = bookingId("COURT 1", "18:00");
  const paymentId = sql(`SELECT id FROM public.payments WHERE booking_id = '${id}'`);

  const res = await page.request.post("/api/bookings/cancel", { data: { bookingId: id } });
  expect(res.status()).toBe(200);
  // Stripe test-mode partial refund through the existing refund worker
  await expect.poll(() => courtRow("COURT 1", "18:00"), { timeout: 30_000 }).toBe("cancelled|refunded|400.00");
  expect(sql(`SELECT amount::numeric(10, 2) || '|' || idempotency_key FROM public.refund_requests WHERE booking_id = '${id}'`)).toBe(
    `400.00|ref_customer_cancel_${paymentId}`
  );
  expect(courtRow("COURT 2", "18:00")).toBe("confirmed|paid|400.00");

  const again = await page.request.post("/api/bookings/cancel", { data: { bookingId: id } });
  expect(again.status()).toBe(409);
  expect(sql(`SELECT count(*) FROM public.refund_requests WHERE booking_id = '${id}'`)).toBe("1");
});

test("a court lost before a late payment is confirmed is refunded alone, and the success page names it", async ({ page }) => {
  await login(page, account("CUSTOMER"));
  // Stand in for a late webhook: the success page (whose verify call confirms the basket) does not load yet
  await page.route("**/book/success**", (route) => route.fulfill({ contentType: "text/html", body: "<p>held</p>" }));
  const res = await checkout(page, [["COURT 3", "16:00", "17:00"], ["COURT 4", "16:00", "17:00"]]);
  expect(res.status()).toBe(200);
  await page.goto((await res.json()).url);
  await payOnStripe(page);
  await page.waitForURL(/\/book\/success\?session_id=/, { timeout: 60_000 });
  const successUrl = page.url();
  expect(courtRow("COURT 3", "16:00")).toBe("pending|pending|200.00");

  // COURT 4's hold is lost (timed out) before the payment is reconciled
  const lostId = bookingId("COURT 4", "16:00");
  const lostPaymentId = sql(`SELECT id FROM public.payments WHERE booking_id = '${lostId}'`);
  sql(`UPDATE public.bookings SET status = 'cancelled', cancel_reason = 'expired' WHERE id = '${lostId}'`);

  await page.unroute("**/book/success**");
  await page.goto(successUrl);
  await expect(page.getByText("These courts could not be secured and were refunded: COURT 4.")).toBeVisible({ timeout: 30_000 });
  expect(courtRow("COURT 3", "16:00")).toBe("confirmed|paid|200.00");
  expect(
    sql(`SELECT count(*) || '|' || max(amount)::numeric(10, 2) || '|' || bool_and(payment_id = '${lostPaymentId}') FROM public.refund_requests WHERE booking_id = '${lostId}'`)
  ).toBe("1|200.00|true");
  expect(sql(`SELECT count(*) FROM public.refund_requests r JOIN public.bookings b ON b.id = r.booking_id WHERE b.start_time = '16:00' AND b.id <> '${lostId}'`)).toBe("0");
});

test("a court taken mid-basket reserves nothing and is dropped from the basket", async ({ page, browser }) => {
  await login(page, account("CUSTOMER"));
  await openTomorrow(page);
  await slot(page, "COURT 3", "8:00 AM - 9:00 AM").click();
  await slot(page, "COURT 4", "8:00 AM - 9:00 AM").click();
  await expect(basket(page).getByText("Your basket · 2 courts")).toBeVisible();

  // CUSTOMER2 takes COURT 4 first, with the old single-court request body
  const other = await browser.newPage();
  await login(other, account("CUSTOMER2"));
  const first = await other.request.post("/api/stripe/checkout", {
    data: { booking_date: date, lines: [{ court_id: courtId("COURT 4"), start_time: "08:00", end_time: "09:00" }] },
  });
  expect(first.status()).toBe(200);
  expect((await first.json()).url).toMatch(/^https:\/\/checkout\.stripe\.com\//);

  await basket(page).getByRole("button", { name: "Continue to Checkout" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Continue to Checkout" }).click();
  await expect(page.getByRole("dialog").getByText(/^COURT 4 .+ was just taken\. Nothing was reserved — please choose again\.$/)).toBeVisible();
  await expect(page.getByText("Removed from your basket (no longer available): COURT 4.")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(basket(page).getByText("Your basket · 1 court")).toBeVisible();
  expect(sql(`SELECT count(*) FROM public.bookings WHERE user_id = '${userId("CUSTOMER")}' AND start_time = '08:00'`)).toBe("0");

  // Release CUSTOMER2's hold so later tests start without an open basket
  const cancel = await other.request.post("/api/bookings/cancel", { data: { bookingId: bookingId("COURT 4", "08:00") } });
  expect(cancel.status()).toBe(200);
  expect(courtRow("COURT 4", "08:00").split("|")[0]).toBe("cancelled");
  await other.close();
});

test("a second checkout while a basket awaits payment is refused", async ({ page }) => {
  await login(page, account("CUSTOMER"));
  expect((await checkout(page, [["COURT 3", "10:00", "11:00"], ["COURT 4", "10:00", "11:00"]])).status()).toBe(200);

  const second = await checkout(page, [["COURT 3", "12:00", "13:00"]]);
  expect(second.status()).toBe(409);
  expect((await second.json()).error).toBe(
    "You already have a reservation awaiting payment. Complete or cancel it under 'My Bookings' first."
  );
  expect(sql(`SELECT count(*) FROM public.bookings WHERE booking_date = '${date}' AND start_time = '12:00'`)).toBe("0");

  await page.goto("/my-bookings");
  await expect(page.getByText("Part of a 2-court booking")).toHaveCount(2);
  const card = page
    .getByText("Part of a 2-court booking")
    .first()
    .locator("xpath=ancestor::*[.//button[normalize-space()='Cancel Reservation']][1]");
  await card.getByRole("button", { name: "Cancel Reservation" }).click();
  await expect(page.getByRole("dialog").getByText("This cancels all 2 courts in this unpaid booking.")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Keep Reservation" }).click();
  await expect(page.getByText("Part of a 2-court booking")).toHaveCount(2);
});

const rowFor = (page, court, time) => page.getByRole("row").filter({ hasText: court }).filter({ hasText: time });

test("staff cannot settle a basket from a list filtered to one of its courts", async ({ page }) => {
  await login(page, account("ADMIN"));
  await page.goto("/admin/bookings");
  await page.getByRole("combobox").filter({ hasText: "All Courts" }).click();
  await page.getByRole("option", { name: "COURT 3" }).click();
  await expect(rowFor(page, "COURT 4", "10:00 AM")).toHaveCount(0);

  await rowFor(page, "COURT 3", "10:00 AM").getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("menuitem", { name: "Collect Payment" }).click();
  const settle = page.getByRole("dialog");
  await settle.getByRole("button", { name: "Cash Payment" }).click();
  await settle.getByRole("button", { name: /Confirm ₱200 Received/ }).click();
  await expect(settle.getByText("This booking has more courts than shown. Refresh and try again.")).toBeVisible();
  expect(courtRow("COURT 3", "10:00")).toBe("pending|pending|200.00");
  expect(courtRow("COURT 4", "10:00")).toBe("pending|pending|200.00");
});

test("staff collect cash for a whole unpaid basket from one court", async ({ page }) => {
  await login(page, account("ADMIN"));
  await page.goto("/admin/bookings");
  await rowFor(page, "COURT 3", "10:00 AM").getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("menuitem", { name: "Collect Payment" }).click();
  const settle = page.getByRole("dialog");
  await expect(settle.getByText("2 courts", { exact: true })).toBeVisible();
  await expect(settle.getByText("Basket Total:")).toBeVisible();
  await settle.getByRole("button", { name: "Cash Payment" }).click();
  await settle.getByRole("button", { name: /Confirm ₱400 Received/ }).click();
  await expect(settle).toHaveCount(0);

  await expect.poll(() => courtRow("COURT 3", "10:00")).toBe("confirmed|paid|200.00");
  expect(courtRow("COURT 4", "10:00")).toBe("confirmed|paid|200.00");
  expect(
    sql(`SELECT sum(p.amount) || '|' || string_agg(DISTINCT p.payment_method, ',') FROM public.payments p
         JOIN public.bookings b ON b.id = p.booking_id WHERE b.booking_date = '${date}' AND b.start_time = '10:00'`)
  ).toBe("400.00|cash");
});

test("staff cancelling one court of an unpaid basket cancels every court", async ({ page, browser }) => {
  const customer = await browser.newPage();
  await login(customer, account("CUSTOMER2"));
  expect((await checkout(customer, [["COURT 3", "14:00", "15:00"], ["COURT 4", "14:00", "15:00"]])).status()).toBe(200);
  await customer.close();

  await login(page, account("ADMIN"));
  await page.goto("/admin/bookings");
  await rowFor(page, "COURT 4", "2:00 PM").getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("menuitem", { name: "Cancel Reservation" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel Reservation" }).click();
  await expect.poll(() => courtRow("COURT 4", "14:00").split("|")[0]).toBe("cancelled");
  expect(courtRow("COURT 3", "14:00").split("|")[0]).toBe("cancelled");
});

test("removing every line closes the basket, and changing the date clears it", async ({ page }) => {
  await login(page, account("CUSTOMER"));
  await openTomorrow(page);
  await slot(page, "COURT 1", "7:00 AM - 8:00 AM").click();
  await slot(page, "COURT 2", "7:00 AM - 8:00 AM").click();
  await expect(basket(page).getByText("Your basket · 2 courts")).toBeVisible();
  await basket(page).getByRole("button", { name: "Remove COURT 1" }).click();
  await expect(basket(page).getByText("Your basket · 1 court")).toBeVisible();
  await basket(page).getByRole("button", { name: "Remove COURT 2" }).click();
  await expect(basket(page)).toHaveCount(0);

  await slot(page, "COURT 1", "7:00 AM - 8:00 AM").click();
  await expect(basket(page)).toBeVisible();
  await page.getByRole("button", { name: "Next day" }).click();
  await expect(page.getByText("Basket cleared for the new date.")).toBeVisible();
  await expect(basket(page)).toHaveCount(0);
});

test("on a phone the basket keeps checkout in view without covering the last grid row @mobile", async ({ page }) => {
  await login(page, account("CUSTOMER"));
  await openTomorrow(page);
  for (const court of ["COURT 1", "COURT 2", "COURT 3"]) await slot(page, court, "7:00 AM - 8:00 AM").click();
  await expect(basket(page).getByText("Your basket · 3 courts")).toBeVisible();
  await expect(basket(page).getByRole("button", { name: "Continue to Checkout" })).toBeInViewport();
  await expect(basket(page).getByText("Total", { exact: true })).toBeInViewport();

  // Scroll to the bottom of the grid's wrapper (the grid card's parent, which pads for the sheet); instant, the page scrolls smoothly
  await slot(page, "COURT 4", "9:00 PM - 10:00 PM").evaluate((button) =>
    button.closest("[aria-busy]").parentElement.scrollIntoView({ block: "end", behavior: "instant" })
  );
  for (const court of ["COURT 1", "COURT 2", "COURT 3", "COURT 4"]) {
    const lastRow = slot(page, court, "9:00 PM - 10:00 PM");
    await expect(lastRow).toBeInViewport();
    const onTop = await lastRow.evaluate((button) => {
      const r = button.getBoundingClientRect();
      return button.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
    });
    expect(onTop, `${court}'s last row is covered`).toBe(true);
  }
});

test("GCash checkout lands on the pay page; GCash hidden when not configured", async ({ page }) => {
  const setGcash = (v) =>
    sql(`UPDATE public.booking_settings SET gcash_account_name = ${v ? "'Club'" : "NULL"}, gcash_number = ${v ? "'09171234567'" : "NULL"}`);
  try {
    await login(page, account("CUSTOMER"));
    setGcash(false);
    await openTomorrow(page);
    await slot(page, "COURT 1", "7:00 AM - 8:00 AM").click();
    await basket(page).getByRole("button", { name: "Continue to Checkout" }).click();
    await expect(page.getByRole("dialog").getByRole("button", { name: "Continue to Checkout" })).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("radio", { name: "GCash" })).toHaveCount(0);

    setGcash(true);
    await page.reload();
    await openTomorrow(page);
    await slot(page, "COURT 1", "7:00 AM - 8:00 AM").click();
    await basket(page).getByRole("button", { name: "Continue to Checkout" }).click();
    await page.getByRole("dialog").getByRole("radio", { name: "GCash" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Continue to Checkout" }).click();
    await page.waitForURL(/\/book\/gcash\?basket=/);
    expect(courtRow("COURT 1", "07:00")).toBe("pending|pending|200.00");
    expect(sql(`SELECT p.payment_method FROM public.payments p JOIN public.bookings b ON b.id = p.booking_id WHERE b.start_time = '07:00' AND b.booking_date = '${date}' AND b.user_id = '${userId("CUSTOMER")}'`)).toBe("gcash");

    // GCash turned off while the basket is held: no form, point the player to Card
    setGcash(false);
    await page.reload();
    await expect(page.getByText("GCash payment is unavailable right now. Cancel this booking in My Bookings and book with Card.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Submit payment" })).toHaveCount(0);

    // Awaiting verification: the player's own slot opens no resume dialog, only a toast
    sql(`UPDATE public.bookings SET hold_expires_at = 'infinity' WHERE start_time = '07:00' AND booking_date = '${date}' AND status = 'pending'`);
    await page.goto("/#booking");
    await page.getByRole("button", { name: "See the full board" }).click();
    await page.getByRole("button", { name: /Tmrw/ }).click();
    await page.locator("#booking").getByRole("button", { name: "Resume your pending booking for COURT 1 at 7:00 AM - 8:00 AM" }).click();
    await expect(page.getByText("Your GCash payment is being verified. You can book again once the club confirms it.").first()).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Booking another slot while verifying: told why, not sent to My Bookings
    const blocked = await checkout(page, [["COURT 2", "09:00", "10:00"]]);
    expect(blocked.status()).toBe(409);
    expect((await blocked.json()).error).toBe("Your GCash payment is being verified. You can book again once the club confirms it.");
  } finally {
    setGcash(false);
    sql(`UPDATE public.payments SET status = 'failed' WHERE booking_id IN (SELECT id FROM public.bookings WHERE start_time = '07:00' AND booking_date = '${date}');
         UPDATE public.bookings SET status = 'cancelled', cancel_reason = 'customer' WHERE start_time = '07:00' AND booking_date = '${date}' AND status = 'pending'`);
  }
});

const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

test("GCash pay page submits reference and screenshot", async ({ page }) => {
  const setGcash = (v) =>
    sql(`UPDATE public.booking_settings SET gcash_account_name = ${v ? "'Club'" : "NULL"}, gcash_number = ${v ? "'09171234567'" : "NULL"}`);
  try {
    setGcash(true);
    await login(page, account("CUSTOMER"));
    await openTomorrow(page);
    await slot(page, "COURT 1", "7:00 AM - 8:00 AM").click();
    await basket(page).getByRole("button", { name: "Continue to Checkout" }).click();
    await page.getByRole("dialog").getByRole("radio", { name: "GCash" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Continue to Checkout" }).click();
    await page.waitForURL(/\/book\/gcash\?basket=/);

    await expect(page.getByText("Send exactly ₱200")).toBeVisible();
    const until = sql(`SELECT to_char(min(hold_expires_at) AT TIME ZONE 'Asia/Manila', 'FMHH12:MI AM') FROM public.bookings WHERE start_time = '07:00' AND booking_date = '${date}' AND status = 'pending'`);
    await expect(page.getByText(`Your courts are held until ${until}.`)).toBeVisible();
    await expect(page.getByText("09171234567")).toBeVisible();
    const submit = page.getByRole("button", { name: "Submit payment" });
    await expect(submit).toBeDisabled();
    await page.getByLabel("GCash reference number").fill("1234567890123");
    await expect(submit).toBeDisabled();
    await page.getByLabel("Payment screenshot").setInputFiles({ name: "receipt.png", mimeType: "image/png", buffer: PNG_1X1 });
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page.getByText("Payment submitted")).toBeVisible();

    await page.goto("/my-bookings");
    await expect(page.getByText("Awaiting verification").first()).toBeVisible();

    // An expired hold shows the expired view
    sql(`UPDATE public.bookings SET status = 'cancelled', cancel_reason = 'customer' WHERE start_time = '07:00' AND booking_date = '${date}' AND status = 'pending'`);
    await page.goBack();
    await page.reload();
    await expect(page.getByText("This reservation has expired")).toBeVisible();
    await expect(page.getByText("Already sent the money? Contact the club at +63 917 123 4567 with your GCash reference.")).toBeVisible();
  } finally {
    setGcash(false);
    sql(`UPDATE public.payments SET status = 'failed' WHERE booking_id IN (SELECT id FROM public.bookings WHERE start_time = '07:00' AND booking_date = '${date}');
         UPDATE public.bookings SET status = 'cancelled', cancel_reason = 'customer' WHERE start_time = '07:00' AND booking_date = '${date}' AND status = 'pending'`);
  }
});
