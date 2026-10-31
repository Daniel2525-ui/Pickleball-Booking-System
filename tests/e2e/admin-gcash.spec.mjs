// Staff verification of GCash payments: local Supabase stack only.
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { requireLocalDb, sql, account, login, tomorrowManila, resetBookings, firstCourt, localSupabase } from "./local-db.mjs";

test.describe.configure({ mode: "serial" });

const date = tomorrowManila();
const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const BASKET_A = "11111111-1111-4111-8111-111111111111"; // one court
const BASKET_B = "22222222-2222-4222-8222-222222222222"; // two courts, verified as one unit
const paths = [];

test.beforeEach(() => requireLocalDb());

async function signedIn(role) {
  const { url, anonKey } = localSupabase();
  const client = createClient(url, anonKey);
  const { error } = await client.auth.signInWithPassword(account(role));
  if (error) throw error;
  return client;
}

// A submitted GCash basket: pending bookings with a permanent hold, a gcash payment with proof and reference
async function seedSubmitted(client, basketId, name, slots, reference) {
  const court = firstCourt();
  const userId = sql(`SELECT id FROM public.profiles WHERE email = '${account("CUSTOMER").email}'`);
  const path = `${userId}/${basketId}-e2e.png`;
  const { error } = await client.storage.from("gcash-receipts").upload(path, PNG_1X1, { contentType: "image/png" });
  if (error) throw error;
  paths.push(path);
  for (const start of slots) {
    const end = `${String(Number(start.slice(0, 2)) + 1).padStart(2, "0")}:00`;
    const id = sql(`INSERT INTO public.bookings (user_id, court_id, booking_date, start_time, end_time, status, total_amount, hold_expires_at, customer_name, basket_id)
      VALUES ('${userId}', '${court.id}', '${date}', '${start}', '${end}', 'pending', 200, 'infinity', '${name}', '${basketId}') RETURNING id`).split(/\s+/)[0];
    sql(`INSERT INTO public.payments (booking_id, amount, currency, status, payment_method, payment_reference, gcash_proof_path, gcash_submitted_at)
      VALUES ('${id}', 200, 'php', 'pending', 'gcash', '${reference}', '${path}', now())`);
  }
}

const rowFor = (page, name) => page.getByRole("row").filter({ hasText: name });

test("admin approves and rejects GCash payments", async ({ page }) => {
  resetBookings();
  const customer = await signedIn("CUSTOMER");
  await seedSubmitted(customer, BASKET_A, "E2E Gcash Reject", ["06:00"], "5550001");
  await seedSubmitted(customer, BASKET_B, "E2E Gcash Approve", ["08:00", "09:00"], "5550002");
  // The same reference on another booking is flagged
  await seedSubmitted(customer, "33333333-3333-4333-8333-333333333333", "E2E Gcash Dup", ["11:00"], "5550002");
  // A two-court basket whose reference nobody else used: its own sibling court must not trigger the warning
  await seedSubmitted(customer, "44444444-4444-4444-8444-444444444444", "E2E Gcash Own", ["13:00", "14:00"], "5550003");
  try {
    await login(page, account("ADMIN"));
    await page.goto("/admin/bookings");
    await page.getByRole("combobox").first().click();
    await expect(page.getByRole("option", { name: /Awaiting Verification \(6\)/ })).toBeVisible();
    await page.getByRole("option", { name: /Awaiting Verification/ }).click();
    await expect(rowFor(page, "E2E Gcash Reject")).toHaveCount(1);
    await expect(rowFor(page, "E2E Gcash Approve")).toHaveCount(2);

    // Approve the two-court basket as one unit
    await rowFor(page, "E2E Gcash Approve").first().getByRole("button", { name: "Open menu" }).click();
    await expect(page.getByRole("menuitem", { name: "Collect Payment" })).toHaveCount(0);
    await page.getByRole("menuitem", { name: "Verify" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("5550002")).toBeVisible();
    await expect(dialog.getByText("2 courts")).toBeVisible();
    await expect(dialog.getByText("₱400")).toBeVisible();
    await expect(dialog.getByText("This reference was also used on another booking")).toBeVisible();
    const img = dialog.getByRole("img", { name: "GCash payment screenshot" });
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate((i) => i.complete && i.naturalWidth > 0)).toBe(true);
    await dialog.getByRole("button", { name: "Approve — mark paid" }).click();
    await expect(rowFor(page, "E2E Gcash Approve").getByText("Confirmed")).toHaveCount(2);

    await rowFor(page, "E2E Gcash Own").first().getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("menuitem", { name: "Verify" }).click();
    await expect(dialog.getByText("5550003")).toBeVisible();
    await expect(dialog.getByText("This reference was also used on another booking")).toHaveCount(0);
    await page.keyboard.press("Escape");

    // Reject the single court
    await rowFor(page, "E2E Gcash Reject").getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("menuitem", { name: "Verify" }).click();
    await expect(dialog.getByText("This reference was also used on another booking")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Reject & release slots" }).click();
    await expect(rowFor(page, "E2E Gcash Reject").getByText("Cancelled")).toBeVisible();

    expect(sql(`SELECT string_agg(b.status || '|' || p.status || '|' || coalesce(b.cancel_reason, ''), ',' ORDER BY b.start_time) FROM public.bookings b JOIN public.payments p ON p.booking_id = b.id WHERE b.customer_name IN ('E2E Gcash Reject', 'E2E Gcash Approve')`))
      .toBe("cancelled|failed|gcash_rejected,confirmed|paid|,confirmed|paid|");

    // A non-admin cannot call the route
    await page.context().clearCookies();
    await login(page, account("CUSTOMER"));
    const res = await page.request.post("/api/admin/payments/gcash-verify", { data: { basketId: BASKET_B, action: "approve" } });
    expect(res.status()).toBe(403);
  } finally {
    const admin = await signedIn("ADMIN");
    await admin.storage.from("gcash-receipts").remove(paths);
    resetBookings();
  }
});
