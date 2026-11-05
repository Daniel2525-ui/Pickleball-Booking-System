// Staff verification of GCash payments: local Supabase stack only.
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { requireLocalDb, sql, account, login, tomorrowManila, resetBookings, firstCourt, localSupabase, openAllBookings } from "./local-db.mjs";

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
  // The basket's second court on another court, so a court filter hides it
  const court = firstCourt();
  sql(`UPDATE public.bookings SET court_id = (SELECT id FROM public.courts WHERE name > '${court.name}' ORDER BY name LIMIT 1)
    WHERE basket_id = '${BASKET_B}' AND start_time = '09:00'`);
  // A paid GCash booking with no basket (legacy) using the reject basket's reference is a duplicate too
  const walkIn = sql(`INSERT INTO public.bookings (user_id, court_id, booking_date, start_time, end_time, status, total_amount, customer_name)
    VALUES ((SELECT id FROM public.profiles WHERE email = '${account("CUSTOMER2").email}'), '${court.id}', '${date}', '16:00', '17:00', 'confirmed', 200, 'E2E Gcash Legacy') RETURNING id`).split(/\s+/)[0];
  sql(`INSERT INTO public.payments (booking_id, amount, currency, status, payment_method, payment_reference, paid_at)
    VALUES ('${walkIn}', 200, 'php', 'paid', 'gcash', '5550001', now())`);
  try {
    // Receipts are private: neither the uploader nor another player can read one back
    const other = await signedIn("CUSTOMER2");
    for (const client of [customer, other]) {
      const signed = await client.storage.from("gcash-receipts").createSignedUrl(paths[0], 60);
      expect(signed.data?.signedUrl).toBeFalsy();
      expect(signed.error).toBeTruthy();
      const file = await client.storage.from("gcash-receipts").download(paths[0]);
      expect(file.data).toBeNull();
      expect(file.error).toBeTruthy();
    }

    await login(page, account("ADMIN"));
    // Filtered to one court of the two-court basket: Verify still shows the whole basket
    await openAllBookings(page);
    await page.getByRole("combobox").filter({ hasText: "All Courts" }).click();
    await page.getByRole("option", { name: court.name, exact: true }).click();
    await expect(rowFor(page, "E2E Gcash Approve")).toHaveCount(1);
    await rowFor(page, "E2E Gcash Approve").getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("menuitem", { name: "Verify" }).click();
    await expect(page.getByRole("dialog").getByText("2 courts")).toBeVisible();
    await expect(page.getByRole("dialog").getByText("₱400")).toBeVisible();
    await page.keyboard.press("Escape");

    await openAllBookings(page);
    await page.getByRole("combobox").first().click();
    await expect(page.getByRole("option", { name: /Awaiting Verification \(6\)/ })).toBeVisible();
    await page.getByRole("option", { name: /Awaiting Verification/ }).click();
    await expect(rowFor(page, "E2E Gcash Reject")).toHaveCount(1);
    await expect(rowFor(page, "E2E Gcash Approve")).toHaveCount(2);

    // Approve the two-court basket as one unit
    await rowFor(page, "E2E Gcash Approve").first().getByRole("button", { name: "Open menu" }).click();
    await expect(page.getByRole("menuitem", { name: "Collect Payment" })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: "Cancel Reservation" })).toHaveCount(0);
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

    // Reject the single court (its reference was also used by the legacy booking)
    await rowFor(page, "E2E Gcash Reject").getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("menuitem", { name: "Verify" }).click();
    await expect(dialog.getByText("This reference was also used on another booking")).toBeVisible();
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

test("admin edits GCash details", async ({ page }) => {
  const saved = () => sql("SELECT coalesce(gcash_account_name, '-') || '|' || coalesce(gcash_number, '-') || '|' || (gcash_qr_url IS NOT NULL) FROM public.booking_settings");
  sql("UPDATE public.booking_settings SET gcash_account_name = NULL, gcash_number = NULL, gcash_qr_url = NULL");
  try {
    await login(page, account("ADMIN"));
    await page.goto("/admin/dashboard");
    await page.getByRole("link", { name: "Settings" }).click();
    await expect(page).toHaveURL(/\/admin\/settings/);

    // Settings that fail to load leave nothing to edit or save
    await page.route("**/rest/v1/booking_settings*", (route) => route.fulfill({ status: 500, contentType: "application/json", body: "{}" }));
    await page.reload();
    await expect(page.getByText("Could not load settings. Reload the page to try again.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save GCash details" })).toHaveCount(0);
    await page.unroute("**/rest/v1/booking_settings*");
    await page.reload();
    const name = page.getByLabel("Account name");
    const number = page.getByLabel("GCash number", { exact: true });
    const save = page.getByRole("button", { name: "Save GCash details" });

    // Invalid number: inline error, nothing saved
    await name.fill("Pickle Club Co.");
    await number.fill("12345");
    await save.click();
    await expect(page.getByText("Enter an 11-digit GCash number starting with 09.")).toBeVisible();
    expect(saved()).toBe("-|-|false");

    // Only one field filled: nothing saved
    await number.fill("");
    await save.click();
    await expect(page.getByText("Enter both the account name and the GCash number, or clear both to turn GCash off.")).toBeVisible();
    expect(saved()).toBe("-|-|false");

    // A new number must be typed twice: a mismatch saves nothing
    const confirm = page.getByLabel("Confirm GCash number");
    await number.fill("09171234567");
    await confirm.fill("09171234576");
    await save.click();
    await expect(page.getByText("The two GCash numbers don't match. Type the new number again.")).toBeVisible();
    expect(saved()).toBe("-|-|false");
    await confirm.fill("09171234567");

    // A save that updates no row (e.g. RLS) is an error, not "saved"
    await page.route("**/rest/v1/booking_settings*", (route) =>
      route.request().method() === "PATCH" ? route.fulfill({ status: 200, contentType: "application/json", body: "[]" }) : route.continue());
    await save.click();
    await expect(page.getByText("GCash details were not saved. Reload the page and try again.")).toBeVisible();
    await page.unroute("**/rest/v1/booking_settings*");

    // Valid: spaces are stripped, and it survives a reload
    await number.fill("0917 123 4567");
    await save.click();
    await expect(page.getByText("GCash details saved.").first()).toBeVisible();
    expect(saved()).toBe("Pickle Club Co.|09171234567|false");
    await page.reload();
    await expect(name).toHaveValue("Pickle Club Co.");
    await expect(number).toHaveValue("09171234567");
    await expect(page.getByLabel("Confirm GCash number")).toHaveCount(0); // unchanged number: nothing to confirm

    // A picked QR is a preview until Save; removing it waits for Save too, and can be undone
    await page.getByLabel("QR code image").setInputFiles({ name: "qr.png", mimeType: "image/png", buffer: PNG_1X1 });
    await expect(page.getByRole("img", { name: "GCash QR code" })).toBeVisible();
    expect(saved()).toBe("Pickle Club Co.|09171234567|false");
    await save.click();
    await expect(page.getByText("GCash details saved.").first()).toBeVisible();
    expect(saved()).toBe("Pickle Club Co.|09171234567|true");
    await page.getByRole("button", { name: "Remove QR" }).click();
    await expect(page.getByRole("img", { name: "GCash QR code" })).toHaveCount(0);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByRole("img", { name: "GCash QR code" })).toBeVisible();
    await page.getByRole("button", { name: "Remove QR" }).click();
    expect(saved()).toBe("Pickle Club Co.|09171234567|true");
    await save.click();
    await expect.poll(saved).toBe("Pickle Club Co.|09171234567|false");
    // The removed QR image file is deleted from storage too
    const storage = (await signedIn("ADMIN")).storage.from("club-assets");
    await expect.poll(async () => ((await storage.list()).data ?? []).filter((f) => f.name.startsWith("gcash-qr-")).length).toBe(0);

    // Every change is recorded with who made it
    const history = page.getByRole("listitem").filter({ hasText: "E2E Admin" });
    await expect(history.filter({ hasText: "QR code removed" })).toHaveCount(1);
    await expect(history.filter({ hasText: "QR code added" })).toHaveCount(1);
    await expect(history.filter({ hasText: "GCash number: 09171234567" })).toHaveCount(1);

    // Clearing both turns GCash off, which hides it in the booking modal
    await name.fill("");
    await number.fill("");
    await save.click();
    await expect(page.getByText("GCash details saved.").first()).toBeVisible();
    expect(saved()).toBe("-|-|false");
  } finally {
    sql("UPDATE public.booking_settings SET gcash_account_name = NULL, gcash_number = NULL, gcash_qr_url = NULL");
    const admin = await signedIn("ADMIN");
    const { data } = await admin.storage.from("club-assets").list();
    const stale = (data ?? []).filter((f) => f.name.startsWith("gcash-qr-")).map((f) => f.name);
    if (stale.length) await admin.storage.from("club-assets").remove(stale);
  }
});
