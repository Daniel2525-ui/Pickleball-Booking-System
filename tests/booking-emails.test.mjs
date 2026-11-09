import test from "node:test";
import assert from "node:assert/strict";
import { groupBookingEmails, planEmails, renderBookingEmail, sendBookingEmails } from "../src/lib/services/bookings/bookingEmails.ts";
import { sendEmail } from "../src/lib/email.ts";

const NOW = Date.parse("2026-11-09T12:00:00+08:00");
const contact = { phone: "0917", phoneHref: "tel:0917", email: "play@venue.ph", address: "Butuan" };
const row = (over = {}) => ({
  id: "b1",
  basket_id: null,
  booking_date: "2026-11-10",
  start_time: "18:00:00",
  end_time: "19:00:00",
  customer_name: "Ana",
  open_play_spots: null,
  confirmation_sent_at: null,
  profiles: { email: "ana@x.ph", full_name: "Ana Cruz" },
  customers: null,
  courts: { name: "Court 1" },
  ...over,
});
const ids = (rows) => rows.map((b) => b.id);

test("confirmation: claims every fetched booking, emails only the ones not yet started", () => {
  const started = row({ id: "past", booking_date: "2026-11-09", start_time: "10:00:00" });
  const { claim, send } = planEmails("confirmation", [row(), started], NOW);
  assert.deepEqual(ids(claim), ["b1", "past"]);
  assert.deepEqual(ids(send), ["b1"]);
});

test("reminder: waits until 24 hours before, skips when the confirmation went out within those 24 hours", () => {
  const later = row({ id: "later", booking_date: "2026-11-10", start_time: "13:00:00" }); // 25h away
  const confirmedEarly = row({ id: "early", confirmation_sent_at: "2026-11-01T00:00:00Z" }); // 30h away
  const soon = row({ id: "soon", start_time: "10:00:00", confirmation_sent_at: "2026-11-01T00:00:00Z" }); // 22h away
  const lastMinute = row({ id: "last", start_time: "10:00:00", confirmation_sent_at: "2026-11-09T11:00:00+08:00" });
  const { claim, send } = planEmails("reminder", [later, confirmedEarly, soon, lastMinute], NOW);
  assert.deepEqual(ids(claim), ["soon", "last"]);
  assert.deepEqual(ids(send), ["soon"]);
});

test("grouping: one email per recipient and basket; no email on file is dropped", () => {
  const groups = groupBookingEmails([
    row({ id: "a", basket_id: "k1" }),
    row({ id: "b", basket_id: "k1", profiles: { email: "ANA@x.ph", full_name: "Ana Cruz" } }),
    row({ id: "c", basket_id: "k2" }),
    row({ id: "walkin", profiles: null, customers: { email: " walk@x.ph ", full_name: "Ben" } }),
    row({ id: "none", profiles: null, customers: { email: null, full_name: "Cy" } }),
  ]);
  assert.deepEqual(groups.map((g) => [g.to, g.name, ids(g.rows)]), [
    ["ana@x.ph", "Ana Cruz", ["a", "b"]],
    ["ana@x.ph", "Ana Cruz", ["c"]],
    ["walk@x.ph", "Ben", ["walkin"]],
  ]);
});

test("render: escapes names, lists courts and open play spots", () => {
  const group = { to: "a@x.ph", name: "<b>Ana</b>", rows: [row({ open_play_spots: 2, courts: null }), row({ id: "b2", start_time: "17:00:00" })] };
  const { subject, html, text } = renderBookingEmail("confirmation", group, contact);
  assert.equal(subject, "Booking confirmed: Tue, Nov 10");
  assert.ok(html.includes("&lt;b&gt;Ana&lt;/b&gt;") && !html.includes("<b>Ana"));
  assert.ok(text.indexOf("Court 1 · Tue, Nov 10 · 5:00 PM") < text.indexOf("Open play (2 spots)"));
  assert.match(renderBookingEmail("reminder", group, contact).subject, /^Reminder: you play Tue, Nov 10 at 5:00 PM$/);
});

// Minimal PostgREST stand-in: records updates, returns the given rows for selects
const fakeDb = (rowsByKind) => {
  const updates = [];
  const from = () => {
    const q = { filters: {}, patch: null };
    const chain = {
      select: () => chain, eq: (c, v) => ((q.filters[c] = v), chain), is: (c, v) => ((q.filters[c] = v), chain),
      gte: () => chain, lte: () => chain, not: () => chain, order: () => chain, limit: () => chain, in: (c, v) => ((q.ids = v), chain),
      maybeSingle: async () => ({ data: null, error: null }),
      update: (p) => ((q.patch = p), chain),
      then: (resolve) => {
        if (q.patch) {
          updates.push({ patch: q.patch, ids: q.ids });
          return resolve({ data: (q.ids ?? []).map((id) => ({ id })), error: null });
        }
        const kind = "reminder_sent_at" in q.filters ? "reminder" : "confirmation";
        return resolve({ data: rowsByKind[kind] ?? [], error: null });
      },
    };
    return chain;
  };
  return { db: { from }, updates };
};

test("send: a temporary failure releases the claim, a permanent one keeps it", async () => {
  const { db, updates } = fakeDb({ confirmation: [row({ id: "ok" }), row({ id: "flaky", profiles: { email: "f@x.ph", full_name: "F" } })] });
  const sent = [];
  const result = await sendBookingEmails(db, { now: NOW, send: async (m) => (sent.push(m), m.to === "f@x.ph" ? "retry" : "sent") });
  assert.deepEqual(result, { confirmations: 1, reminders: 0 });
  assert.equal(sent.length, 2);
  assert.deepEqual(updates.map((u) => [Object.values(u.patch)[0] === null ? "release" : "claim", u.ids]), [
    ["claim", ["ok", "flaky"]],
    ["release", ["flaky"]],
  ]);
});

test("resend client: maps status codes to sent / retry / rejected", async () => {
  const msg = { to: "a@x.ph", subject: "s", html: "h", text: "t", idempotencyKey: "k" };
  const at = (status) => sendEmail(msg, { apiKey: "re_x", from: "V <v@x.ph>", fetch: async () => new Response("{}", { status }) });
  assert.equal(await at(200), "sent");
  assert.equal(await at(429), "retry");
  assert.equal(await at(503), "retry");
  assert.equal(await at(422), "rejected");
  assert.equal(await sendEmail(msg, { fetch: async () => { throw new Error("offline"); } }), "retry");
});
