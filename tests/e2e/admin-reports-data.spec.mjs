// The numbers behind the Reports page (get_venue_report), checked against known September data. Local Supabase stack only.
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { writesAllowed, requireLocalDb, sql, account, resetBookings, firstCourt, localSupabase } from "./local-db.mjs";

test.describe.configure({ mode: "serial" });

let court;
const clients = {};
async function signedIn(role) {
  if (clients[role]) return clients[role];
  const { url, anonKey } = localSupabase();
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword(account(role));
  if (error) throw error;
  return (clients[role] = client);
}
async function report(from, to, role = "ADMIN") {
  const { data, error } = await (await signedIn(role)).rpc("get_venue_report", { p_from: from, p_to: to });
  if (error) throw new Error(error.message);
  return data;
}

const userId = (role = "CUSTOMER") => sql(`SELECT id FROM public.profiles WHERE email = '${account(role).email}'`);
const first = (out) => out.split(/\s+/)[0];

// A booking on `court` (or an open-play spot when `spots` is set); returns its id
function book(date, start, end, { status = "completed", reason = null, user = userId(), customer = null, name = "E2E Report", session = null, spots = null, onCourt = court.id, amount = 200 } = {}) {
  const who = customer ? `NULL, '${customer}'` : user ? `'${user}', NULL` : "NULL, NULL";
  return first(sql(`INSERT INTO public.bookings (user_id, customer_id, court_id, booking_date, start_time, end_time, status, cancel_reason, total_amount, customer_name, open_play_session_id, open_play_spots)
    VALUES (${who}, ${onCourt ? `'${onCourt}'` : "NULL"}, '${date}', '${start}', '${end}', '${status}', ${reason ? `'${reason}'` : "NULL"}, ${amount}, '${name}',
            ${session ? `'${session}'` : "NULL"}, ${spots ?? "NULL"}) RETURNING id`));
}
// A payment; `paidAt` is a Manila wall-clock time like '2026-09-10 10:00', or a full timestamp with offset
function pay(bookingId, amount, status, method, paidAt) {
  const at = paidAt ? `'${paidAt.includes("+") ? paidAt : paidAt + ":00+08"}'` : "NULL";
  sql(`INSERT INTO public.payments (booking_id, amount, currency, status, payment_method, paid_at) VALUES ('${bookingId}', ${amount}, 'php', '${status}', ${method ? `'${method}'` : "NULL"}, ${at})`);
}
function openPlaySession(date) {
  const schedule = first(sql(`INSERT INTO public.open_play_schedules (day_of_week, start_time, end_time, court_ids, capacity, price_per_spot, active)
    VALUES (trim(to_char('${date}'::date, 'Day')), '19:00', '21:00', ARRAY['${court.id}'::uuid], 16, 150, false) RETURNING id`));
  return first(sql(`INSERT INTO public.open_play_sessions (schedule_id, session_date, start_time, end_time, court_ids, capacity, price_per_spot, status)
    VALUES ('${schedule}', '${date}', '19:00', '21:00', ARRAY['${court.id}'::uuid], 16, 150, 'open') RETURNING id`));
}
function reset() {
  resetBookings();
  sql("DELETE FROM public.open_play_sessions WHERE schedule_id IN (SELECT id FROM public.open_play_schedules WHERE active = false AND capacity = 16 AND price_per_spot = 150); DELETE FROM public.open_play_schedules WHERE active = false AND capacity = 16 AND price_per_spot = 150");
}

// September 10: every kind of payment, including a refunded one and an open-play spot
function seedMoney() {
  pay(book("2026-09-10", "08:00", "09:00"), 400, "paid", "cash", "2026-09-10 10:00");
  pay(book("2026-09-10", "09:00", "10:00"), 200, "paid", "gcash", "2026-09-10 10:00");
  pay(book("2026-09-10", "10:00", "11:00"), 300, "paid", "stripe", "2026-09-10 10:00");
  pay(book("2026-09-10", "11:00", "12:00", { status: "cancelled", reason: "customer" }), 250, "refunded", "stripe", "2026-09-10 10:00");
  pay(book("2026-09-10", "12:00", "13:00", { status: "pending" }), 999, "pending", null, null);
  pay(book("2026-09-10", "13:00", "14:00", { status: "cancelled", reason: "checkout_failed" }), 500, "failed", "stripe", null);
  const session = openPlaySession("2026-09-10");
  pay(book("2026-09-10", "19:00", "21:00", { status: "confirmed", session, spots: 1, onCourt: null, amount: 150 }), 150, "paid", "gcash", "2026-09-10 10:00");
}

test.beforeAll(() => { if (writesAllowed) court = firstCourt(); });
test.beforeEach(() => { requireLocalDb(); reset(); });
test.afterAll(() => { if (writesAllowed) reset(); });

test("the owner gets September's money right", async () => {
  seedMoney();
  const r = await report("2026-09-01", "2026-09-30");
  expect(r.money).toEqual({ net: 1050, cash: 400, gcash: 350, card: 300, refunded: 250, refunded_count: 1, court: 900, open_play: 150 });
});

test("a refunded payment never reduces net twice", async () => {
  seedMoney();
  const r = await report("2026-09-01", "2026-09-30");
  const day = r.series.find((s) => s.key === "2026-09-10");
  const paidThatDay = Number(sql(`SELECT sum(amount) FROM public.payments WHERE status = 'paid' AND (paid_at AT TIME ZONE 'Asia/Manila')::date = '2026-09-10'`));
  expect(day.net).toBe(paidThatDay);
  expect(day.net).toBe(1050);
  expect(day.refunded).toBe(250);
});

test("a payment at 11:30 PM Manila on the last day stays in that month", async () => {
  pay(book("2026-09-30", "20:00", "21:00"), 200, "paid", "cash", "2026-09-30 15:30:00+00");
  expect((await report("2026-09-01", "2026-09-30")).money.net).toBe(200);
  expect((await report("2026-10-01", "2026-10-31")).money.net).toBe(0);
});

test("bookings, cancellations, no-shows and money kept", async () => {
  for (const h of ["08", "09", "10"]) book("2026-09-11", `${h}:00`, `${Number(h) + 1}:00`.padStart(5, "0"));
  pay(book("2026-09-11", "11:00", "12:00", { status: "no_show" }), 200, "paid", "cash", "2026-09-11 09:00");
  book("2026-09-11", "12:00", "13:00", { status: "cancelled", reason: "customer" });
  pay(book("2026-09-11", "13:00", "14:00", { status: "cancelled", reason: "payment_kept" }), 200, "paid", "cash", "2026-09-11 09:00");
  book("2026-09-11", "14:00", "15:00", { status: "cancelled", reason: "expired" });
  book("2026-09-11", "15:00", "16:00", { status: "pending" });
  const r = await report("2026-09-01", "2026-09-30");
  expect(r.bookings).toEqual({ count: 4, court_hours: 4, cancelled: 2, no_shows: 1, money_kept: 400 });
});

test("closures and closed weekdays reduce open hours", async () => {
  const courts = Number(sql("SELECT count(*) FROM public.courts"));
  sql("UPDATE public.operating_hours SET is_open = false WHERE day_of_week = 'Sunday'");
  sql("INSERT INTO public.venue_closures (closed_on, reason) VALUES ('2026-09-15', 'E2E closure')");
  const session = openPlaySession("2026-09-16");
  // The open-play court block: a court booking with no player, tied to the session
  book("2026-09-16", "19:00", "21:00", { status: "confirmed", user: null, session, amount: 0, name: "Open play" });
  const r = await report("2026-09-14", "2026-09-20");
  expect(r.occupancy.open_hours).toBe(courts * 16 * 5);
  expect(r.occupancy.booked_hours).toBe(2);
  // Wednesday (dow 2) 7 PM and 8 PM: one court of `courts` booked on the one open Wednesday
  const cell = (dow, hour) => r.heatmap.find((c) => c.dow === dow && c.hour === hour);
  expect([cell(2, 19).pct, cell(2, 20).pct, cell(2, 18).pct]).toEqual([Math.round(100 / courts), Math.round(100 / courts), 0]);
  expect(cell(6, 10)).toBeUndefined(); // Sunday closed: no cells
  expect(cell(1, 10)).toBeUndefined(); // the only Tuesday was a closure date
});

test("an empty period is all zeros", async () => {
  let r = await report("2026-08-01", "2026-08-31");
  expect(r.money.net).toBe(0);
  expect(r.bookings.count).toBe(0);
  expect(r.top_customers).toEqual([]);
  expect(r.series).toHaveLength(31);
  sql("UPDATE public.operating_hours SET is_open = false");
  r = await report("2026-08-01", "2026-08-31");
  expect(r.occupancy.pct).toBeNull();
  expect(r.heatmap).toEqual([]);
});

test("previous period and buckets", async () => {
  pay(book("2026-09-05", "08:00", "09:00"), 300, "paid", "cash", "2026-09-05 09:00");
  pay(book("2026-09-10", "08:00", "09:00"), 200, "paid", "cash", "2026-09-10 09:00");
  const week = await report("2026-09-08", "2026-09-14");
  expect(week.money.net).toBe(200);
  expect(week.previous.net).toBe(300);
  expect((await report(null, null)).previous).toBeNull();
  const quarter = await report("2026-06-01", "2026-08-29");
  expect(quarter.period.bucket).toBe("month");
  expect(quarter.series.map((s) => s.key)).toEqual(["2026-06", "2026-07", "2026-08"]);
});

test("only the owner can run it", async () => {
  const customer = await (await signedIn("CUSTOMER")).rpc("get_venue_report", { p_from: "2026-09-01", p_to: "2026-09-30" });
  expect(customer.error?.message).toContain("FORBIDDEN");
  sql(`UPDATE public.profiles SET role = 'admin', is_owner = false WHERE email = '${account("CUSTOMER2").email}'`);
  try {
    const frontDesk = await (await signedIn("CUSTOMER2")).rpc("get_venue_report", { p_from: "2026-09-01", p_to: "2026-09-30" });
    expect(frontDesk.error?.message).toContain("FORBIDDEN");
  } finally {
    sql(`UPDATE public.profiles SET role = 'customer', is_owner = false WHERE email = '${account("CUSTOMER2").email}'`);
  }
  const backwards = await (await signedIn("ADMIN")).rpc("get_venue_report", { p_from: "2026-09-30", p_to: "2026-09-01" });
  expect(backwards.error?.message).toContain("INVALID_ARGUMENT");
});

test("top customers group walk-ins", async () => {
  const walkIn = first(sql("INSERT INTO public.customers (full_name) VALUES ('E2E Walk Regular') RETURNING id"));
  pay(book("2026-09-12", "08:00", "09:00", { user: null, customer: walkIn, name: "E2E Walk Regular" }), 200, "paid", "cash", "2026-09-12 09:00");
  pay(book("2026-09-12", "09:00", "10:00", { user: null, customer: walkIn, name: "E2E Walk Regular" }), 200, "paid", "cash", "2026-09-12 10:00");
  pay(book("2026-09-12", "10:00", "11:00"), 200, "paid", "gcash", "2026-09-12 11:00");
  const r = await report("2026-09-01", "2026-09-30");
  expect(r.top_customers[0]).toEqual({ name: "E2E Walk Regular", visits: 2, hours: 2, spent: 400, last_visit: "2026-09-12" });
  expect(r.top_customers[1].name).toBe(sql(`SELECT full_name FROM public.profiles WHERE email = '${account("CUSTOMER").email}'`));
  expect(r.top_customers[1].spent).toBe(200);
});

test("tied customers are listed by name", async () => {
  for (const [name, start] of [["Zed Tie", "08:00"], ["Abe Tie", "09:00"], ["Mia Tie", "10:00"]]) {
    const walkIn = first(sql(`INSERT INTO public.customers (full_name) VALUES ('${name}') RETURNING id`));
    pay(book("2026-09-13", start, `${String(Number(start.slice(0, 2)) + 1).padStart(2, "0")}:00`, { user: null, customer: walkIn, name }), 200, "paid", "cash", "2026-09-13 12:00");
  }
  const r = await report("2026-09-01", "2026-09-30");
  expect(r.top_customers.map((c) => c.name)).toEqual(["Abe Tie", "Mia Tie", "Zed Tie"]);
});

test("a period still under way is compared with the same days before it, not the whole previous period", async () => {
  // A 7-day period that started 2 days ago: 3 days have happened (today included)
  const day = (offset) => sql(`SELECT ((now() AT TIME ZONE 'Asia/Manila')::date + ${offset})::text`);
  pay(book(day(-1), "08:00", "09:00"), 300, "paid", "cash", `${day(-1)} 09:00`);
  pay(book(day(-9), "08:00", "09:00"), 300, "paid", "cash", `${day(-9)} 09:00`); // first day of the previous 7
  pay(book(day(-5), "08:00", "09:00"), 500, "paid", "cash", `${day(-5)} 09:00`); // previous 7, but after its first 3 days
  const r = await report(day(-2), day(4));
  expect(r.previous.net).toBe(300);
  expect(r.so_far).toEqual({ net: 300, count: 1, cancelled_and_no_shows: 0 });
  expect(r.previous.count).toBe(1);
});
