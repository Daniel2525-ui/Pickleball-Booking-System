// Open play players panel: cancel one player (refund or keep), history, tap-to-call. Local Supabase stack only.
import { test, expect } from "@playwright/test";
import { writesAllowed, requireLocalDb, sql, account, login, tomorrowManila, resetBookings, firstCourt } from "./local-db.mjs";

test.describe.configure({ mode: "serial" });

const date = tomorrowManila();
const weekday = new Date(`${date}T12:00:00+08:00`).toLocaleDateString("en-US", { weekday: "long", timeZone: "Asia/Manila" });
const shortDate = new Date(`${date}T00:00:00+08:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "Asia/Manila" });
const ids = {};

const wipe = () => {
  resetBookings();
  sql("DELETE FROM public.open_play_sessions; DELETE FROM public.open_play_schedules;");
};

// A paid spot booking in the session: a member (user) or a walk-up record (customer)
function spot(name, spots, who, method) {
  const owner = who === "member"
    ? `user_id = '${sql(`SELECT id FROM public.profiles WHERE email = '${account("CUSTOMER").email}'`)}'`
    : `customer_id = '${sql(`INSERT INTO public.customers (full_name, phone) VALUES ('${name}', '09185550000') RETURNING id`).split(/\s+/)[0]}'`;
  const [col, val] = owner.split(" = ");
  const id = sql(`INSERT INTO public.bookings (${col}, open_play_session_id, open_play_spots, booking_date, start_time, end_time, status, total_amount, customer_name)
    VALUES (${val}, '${ids.session}', ${spots}, '${date}', '18:00', '20:00', 'confirmed', ${150 * spots}, '${name}') RETURNING id`).split(/\s+/)[0];
  sql(`INSERT INTO public.payments (booking_id, amount, currency, status, payment_method, paid_at) VALUES ('${id}', ${150 * spots}, 'php', 'paid', '${method}', now())`);
  ids[name] = id;
}

test.beforeAll(() => {
  if (!writesAllowed) return;
  wipe();
  // Inactive schedule so the session generator leaves it alone
  const schedule = sql(`INSERT INTO public.open_play_schedules (day_of_week, start_time, end_time, court_ids, capacity, price_per_spot, active)
    VALUES ('${weekday}', '18:00', '20:00', ARRAY['${firstCourt().id}']::uuid[], 6, 150, false) RETURNING id`).split(/\s+/)[0];
  ids.session = sql(`INSERT INTO public.open_play_sessions (schedule_id, session_date, start_time, end_time, court_ids, capacity, price_per_spot, status)
    VALUES ('${schedule}', '${date}', '18:00', '20:00', ARRAY['${firstCourt().id}']::uuid[], 6, 150, 'open') RETURNING id`).split(/\s+/)[0];
  spot("E2E Walkup Wally", 2, "walk-in", "cash");
  spot("E2E Member Mia", 1, "member", "stripe");
});
test.afterAll(() => { if (writesAllowed) wipe(); });
test.beforeEach(() => requireLocalDb());

async function openPlayers(page) {
  await page.goto("/admin/open-play");
  await page.getByRole("row").filter({ hasText: shortDate }).getByRole("button", { name: "Actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Players" }).click();
  await expect(page.getByText(/Players for/)).toBeVisible();
}

const playerRow = (page, name) => page.getByRole("row").filter({ hasText: name });

test("a session on a closed date is marked for staff, with a reminder to refund", async ({ page }) => {
  sql(`INSERT INTO public.venue_closures (closed_on, reason) VALUES ('${date}', 'E2E Storm')`);
  try {
    await login(page, account("ADMIN"));
    await page.goto("/admin/open-play");
    await expect(page.getByRole("row").filter({ hasText: shortDate })).toContainText("Venue closed (E2E Storm): cancel to refund players");
    await openPlayers(page);
    await expect(page.getByRole("alert").filter({ hasText: "The venue is closed on this date" }))
      .toContainText("Cancel the session to refund the players already booked, or reopen the date.");
  } finally {
    sql(`DELETE FROM public.venue_closures WHERE closed_on = '${date}'`);
  }
});

test("staff cancel one player with a refund and another keeping the payment; the session stays open", async ({ page }) => {
  await login(page, account("ADMIN"));
  await openPlayers(page);
  await expect(page.getByText("3 of 6 spots booked")).toBeVisible();
  await expect(playerRow(page, "E2E Walkup Wally").getByRole("link", { name: "09185550000" })).toHaveAttribute("href", "tel:09185550000");
  await expect(playerRow(page, "E2E Walkup Wally")).toContainText(`Ref ${ids["E2E Walkup Wally"].slice(0, 6).toUpperCase()}`);

  // Refund the member
  await page.getByRole("button", { name: "Actions for E2E Customer" }).click();
  await page.getByRole("menuitem", { name: "Cancel Player" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Cancel Reservation" }).click();
  await expect(page.getByText("Player cancelled. Their spots are free again.")).toBeVisible();
  await expect(playerRow(page, "E2E Customer")).toContainText("Cancelled · refund owed");

  // Keep the walk-up's payment
  await page.getByRole("button", { name: "Actions for E2E Walkup Wally" }).click();
  await page.getByRole("menuitem", { name: "Cancel Player" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel(/Cancel and keep the payment/).check();
  await dialog.getByLabel("Reason for keeping the payment").fill("No-show notice too late");
  await dialog.getByRole("button", { name: "Cancel Reservation" }).click();
  await expect(page.getByText("Player cancelled. The payment was kept.")).toBeVisible();
  await expect(playerRow(page, "E2E Walkup Wally")).toContainText("Cancelled · payment kept");

  expect(sql(`SELECT status FROM public.open_play_sessions WHERE id = '${ids.session}'`)).toBe("open");
  expect(sql(`SELECT string_agg(cancel_reason, ',' ORDER BY customer_name) FROM public.bookings WHERE open_play_session_id = '${ids.session}'`)).toBe("admin,payment_kept"); // Member Mia refunded, Walkup Wally kept
  await expect(page.getByText("0 of 6 spots booked")).toBeVisible();
});

test("each player's history opens from the panel", async ({ page }) => {
  await login(page, account("ADMIN"));
  await openPlayers(page);
  await page.getByRole("button", { name: "Actions for E2E Walkup Wally" }).click();
  await page.getByRole("menuitem", { name: "History" }).click();
  await expect(page.getByRole("dialog").getByRole("listitem").last()).toContainText("payment kept: No-show notice too late");
});

test("a session that couldn't be created links to the bookings on its date", async ({ page }) => {
  const later = sql("SELECT ((now() AT TIME ZONE 'Asia/Manila')::date + 2)::text");
  const schedule = sql(`SELECT schedule_id FROM public.open_play_sessions WHERE id = '${ids.session}'`);
  sql(`INSERT INTO public.open_play_sessions (schedule_id, session_date, start_time, end_time, court_ids, capacity, price_per_spot, status, flag_reason)
       VALUES ('${schedule}', '${later}', '18:00', '20:00', ARRAY['${firstCourt().id}']::uuid[], 6, 150, 'flagged', 'COURT 1 is already booked at 6 PM')`);
  await login(page, account("ADMIN"));
  await page.goto("/admin/open-play");
  await page.getByRole("link", { name: "View booking" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/admin/bookings" && url.searchParams.get("date") === later);
  await expect(page.getByLabel("Filter by booking date")).toHaveValue(later);
});

test("after a session ends, the cron records its players as played (System), and leaves cancelled ones alone", async ({ request }) => {
  const secret = process.env.E2E_CRON_SECRET;
  test.skip(!secret, "set E2E_CRON_SECRET to the local app's CRON_SECRET");
  const yesterday = sql("SELECT ((now() AT TIME ZONE 'Asia/Manila')::date - 1)::text");
  const schedule = sql(`SELECT schedule_id FROM public.open_play_sessions WHERE id = '${ids.session}'`);
  const past = sql(`INSERT INTO public.open_play_sessions (schedule_id, session_date, start_time, end_time, court_ids, capacity, price_per_spot, status)
    VALUES ('${schedule}', '${yesterday}', '18:00', '20:00', ARRAY['${firstCourt().id}']::uuid[], 6, 150, 'open') RETURNING id`).split(/\s+/)[0];
  const userId = sql(`SELECT id FROM public.profiles WHERE email = '${account("CUSTOMER").email}'`);
  const add = (name, status) => sql(`INSERT INTO public.bookings (user_id, open_play_session_id, open_play_spots, booking_date, start_time, end_time, status, total_amount, customer_name)
    VALUES ('${userId}', '${past}', 1, '${yesterday}', '18:00', '20:00', '${status}', 150, '${name}') RETURNING id`).split(/\s+/)[0];
  const played = add("E2E Played Yesterday", "confirmed");
  const cancelled = add("E2E Cancelled Yesterday", "cancelled");

  const res = await request.get("/api/cron/cleanup-expired-bookings", { headers: { authorization: `Bearer ${secret}` } });
  expect(res.status()).toBe(200);
  expect(sql(`SELECT status || '|' || (completed_at IS NOT NULL) FROM public.bookings WHERE id = '${played}'`)).toBe("completed|true");
  expect(sql(`SELECT status FROM public.bookings WHERE id = '${cancelled}'`)).toBe("cancelled");
  expect(sql(`SELECT action || '|' || coalesce(actor_id::text, 'system') FROM public.booking_events WHERE booking_id = '${played}' ORDER BY id DESC LIMIT 1`)).toBe("completed|system");
});

test("the Past view shows how full each session was, who played, and the money held", async ({ page }) => {
  const twoDaysAgo = sql("SELECT ((now() AT TIME ZONE 'Asia/Manila')::date - 2)::text");
  const label = new Date(`${twoDaysAgo}T12:00:00+08:00`).toLocaleDateString("en-US", { timeZone: "Asia/Manila", weekday: "short", month: "short", day: "numeric" });
  const schedule = sql(`SELECT schedule_id FROM public.open_play_sessions WHERE id = '${ids.session}'`);
  const past = sql(`INSERT INTO public.open_play_sessions (schedule_id, session_date, start_time, end_time, court_ids, capacity, price_per_spot, status)
    VALUES ('${schedule}', '${twoDaysAgo}', '18:00', '20:00', ARRAY['${firstCourt().id}']::uuid[], 6, 150, 'open') RETURNING id`).split(/\s+/)[0];
  const userId = sql(`SELECT id FROM public.profiles WHERE email = '${account("CUSTOMER").email}'`);
  const id = sql(`INSERT INTO public.bookings (user_id, open_play_session_id, open_play_spots, booking_date, start_time, end_time, status, total_amount, customer_name)
    VALUES ('${userId}', '${past}', 1, '${twoDaysAgo}', '18:00', '20:00', 'completed', 150, 'E2E Played Before') RETURNING id`).split(/\s+/)[0];
  sql(`INSERT INTO public.payments (booking_id, amount, currency, status, payment_method, paid_at) VALUES ('${id}', 150, 'php', 'paid', 'cash', now() - interval '2 days')`);

  await login(page, account("ADMIN"));
  await page.goto("/admin/open-play");
  await page.getByRole("button", { name: "Past 28 days" }).click();
  const row = page.getByRole("row").filter({ hasText: label });
  const cells = row.getByRole("cell");
  await expect(cells.nth(2)).toHaveText("1 / 6");
  await expect(cells.nth(3)).toHaveText("1");
  await expect(cells.nth(4)).toHaveText("₱150");

  await row.getByRole("button", { name: `Players for ${label}` }).click();
  await expect(page.getByText(/Players for/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Add player" })).toHaveCount(0);
});
