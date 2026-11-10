import test from "node:test";
import assert from "node:assert/strict";
import { liveCourtTile, tileColumns } from "../src/lib/services/dashboard/liveCourts.ts";

// 7:35 PM in Manila on Nov 5
const now = new Date("2026-11-05T19:35:00+08:00");
const court = { id: "c1", name: "COURT 1", status: "active" };
const slot = (start, end, o = {}) => ({
    id: `${start}`, court_id: "c1", booking_date: "2026-11-05", start_time: start, end_time: end, status: "confirmed",
    total_amount: 400, open_play_session_id: null, customer_name: null, profiles: { full_name: "Maria Santos" }, customers: null,
    payments: [{ status: "paid", amount: 400, payment_method: "gcash" }], ...o,
});

test("a court in play shows the player, slot, time left and that they paid", () => {
    const tile = liveCourtTile(court, [slot("19:00", "20:00"), slot("20:00", "21:00", { profiles: { full_name: "Jun Dela Cruz" } })], now);
    assert.equal(tile.state, "in_play");
    assert.equal(tile.who, "Maria Santos");
    assert.deepEqual(tile.slot, { start: "19:00", end: "20:00" });
    assert.equal(tile.minutesLeft, 25);
    assert.equal(Math.round(tile.progress * 100), 58);
    assert.deepEqual(tile.payment, { paid: true, label: "Paid · QR Ph" });
    assert.deepEqual(tile.next, { name: "Jun Dela Cruz", start: "20:00" });
});

test("an unpaid walk-in says so and how much to collect", () => {
    const walkIn = slot("18:30", "20:30", {
        profiles: null, customers: { full_name: "Carlo Tan" }, customer_name: "Carlo Tan",
        payments: [{ status: "pending", amount: 400, payment_method: null }],
    });
    const tile = liveCourtTile(court, [walkIn], now);
    assert.equal(tile.who, "Walk-in · Carlo Tan");
    assert.deepEqual(tile.payment, { paid: false, label: "Unpaid · collect ₱400" });
    assert.equal(tile.minutesLeft, 55);
    assert.equal(tile.next, null);
});

test("a free court says until when, or that nothing else is booked", () => {
    const later = liveCourtTile(court, [slot("21:00", "22:00", { profiles: { full_name: "Paolo Reyes" } })], now);
    assert.equal(later.state, "free");
    assert.equal(later.freeUntil, "21:00");
    assert.deepEqual(later.next, { name: "Paolo Reyes", start: "21:00" });
    const empty = liveCourtTile(court, [slot("08:00", "09:00")], now);
    assert.equal(empty.state, "free");
    assert.equal(empty.freeUntil, null);
    assert.equal(empty.next, null);
});

test("open play shows its spots instead of a player", () => {
    const block = slot("19:00", "21:00", { open_play_session_id: "s1", profiles: null, customer_name: "Open play", payments: [] });
    const tile = liveCourtTile(court, [block], now, { s1: { booked: 11, capacity: 16 } });
    assert.equal(tile.state, "open_play");
    assert.deepEqual(tile.spots, { booked: 11, capacity: 16 });
    assert.equal(tile.minutesLeft, 85);
    assert.equal(tile.payment, null);
});

test("maintenance and closed courts ignore bookings", () => {
    assert.equal(liveCourtTile({ ...court, status: "maintenance", maintenance_note: "Net repair" }, [slot("19:00", "20:00")], now).state, "maintenance");
    assert.equal(liveCourtTile({ ...court, status: "closed" }, [], now).state, "closed");
});

test("a court with bookings for other courts is free", () => {
    assert.equal(liveCourtTile(court, [slot("19:00", "20:00", { court_id: "c2" })], now).state, "free");
});

test("a player whose GCash payment staff haven't checked yet is shown as waiting, not unpaid", () => {
    const waiting = slot("19:00", "20:00", { status: "pending", hold_expires_at: "infinity", payments: [{ status: "pending", amount: 400, payment_method: "gcash" }] });
    const tile = liveCourtTile(court, [waiting], now);
    assert.equal(tile.state, "in_play");
    assert.deepEqual(tile.payment, { paid: false, label: "GCash · waiting for your check" });
});

test("tile columns keep rows even, at most 4 across", () => {
  const cols = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(tileColumns);
  assert.deepEqual(cols, [1, 1, 2, 3, 4, 3, 3, 4, 4, 3]);
});
