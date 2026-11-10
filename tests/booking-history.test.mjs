import test from "node:test";
import assert from "node:assert/strict";
import { describeEvent } from "../src/lib/services/bookings/bookingHistory.ts";

const ev = (fields) => ({ id: 1, action: "created", detail: null, actor_id: null, created_at: "2026-11-05T10:00:00Z", profiles: null, ...fields });

test("describeEvent names who did it: staff by name, the player, or the system", () => {
    assert.deepEqual(describeEvent(ev({ action: "checked_in", actor_id: "s1", profiles: { full_name: "Ana Cruz" } }), "u1"), { what: "Checked in", who: "Ana Cruz", detail: null });
    assert.equal(describeEvent(ev({ action: "cancelled", actor_id: "u1", detail: "customer" }), "u1").who, "the player");
    assert.equal(describeEvent(ev({ action: "no_show" }), "u1").who, "System");
});

test("describeEvent words the details staff need", () => {
    assert.equal(describeEvent(ev({ detail: "pending" }), null).what, "Booked online, awaiting payment");
    assert.equal(describeEvent(ev({ detail: "completed" }), null).what, "Recorded as played");
    assert.equal(describeEvent(ev({ detail: "confirmed" }), null).what, "Booked");
    assert.equal(describeEvent(ev({ action: "cancelled", detail: "gcash_rejected" }), null).detail, "GCash payment rejected");
    assert.equal(describeEvent(ev({ action: "cancelled", detail: "payment_kept|Late cancellation" }), null).detail, "payment kept: Late cancellation");
    assert.equal(describeEvent(ev({ action: "cancelled", detail: "admin" }), null).detail, null);
    assert.equal(describeEvent(ev({ action: "paid", detail: "gcash · ref 7741 · 300.00" }), null).detail, "QR Ph · ref 7741 · ₱300");
    assert.equal(describeEvent(ev({ action: "refunded", detail: "stripe · 1200.00" }), null).detail, "QR Ph · ₱1,200");
    assert.equal(describeEvent(ev({ action: "moved", detail: "COURT 1 · Nov 6 10:00 AM → COURT 2 · Nov 6 10:00 AM" }), null).detail, "COURT 1 · Nov 6 10:00 AM → COURT 2 · Nov 6 10:00 AM");
});
