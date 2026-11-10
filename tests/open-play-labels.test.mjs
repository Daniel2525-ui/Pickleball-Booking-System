import test from "node:test";
import assert from "node:assert/strict";
import { parseSpotRequest } from "../src/lib/services/openPlay/openPlayTypes.ts";
import { bookingTitle } from "../src/lib/services/openPlay/bookingTitle.ts";
import { checkSlotAvailability } from "../src/lib/services/bookings/checkSlotAvailability.service.ts";

test("parseSpotRequest accepts 1-4 spots and online payment only", () => {
    assert.ok("error" in parseSpotRequest({ sessionId: "s", spots: 2, payment_method: "gcash" }));
    assert.deepEqual(parseSpotRequest({ sessionId: "s", spots: 4 }), { sessionId: "s", spots: 4, method: "stripe" });
    for (const spots of [0, 5, 2.5, "2", undefined]) assert.ok("error" in parseSpotRequest({ sessionId: "s", spots }), String(spots));
    assert.ok("error" in parseSpotRequest({ sessionId: "s", spots: 2, payment_method: "cash" }));
    assert.ok("error" in parseSpotRequest({ spots: 2 }));
    assert.ok("error" in parseSpotRequest(null));
});

test("bookingTitle names open play spots and falls back to the court", () => {
    assert.equal(bookingTitle({ open_play_spots: 1 }), "Open play · 1 spot");
    assert.equal(bookingTitle({ open_play_spots: 3 }), "Open play · 3 spots");
    assert.equal(bookingTitle({ courts: { name: "Court 2" } }), "Court 2");
    assert.equal(bookingTitle({}), "Court");
});

test("checkSlotAvailability reports open_play for a session block row", () => {
    const courts = [{ id: "c1", name: "Court 1", status: "active" }];
    const row = { id: null, court_id: "c1", start_time: "18:00:00", end_time: "21:00:00", status: "confirmed" };
    const date = new Date("2099-01-01T00:00:00+08:00");
    const slot = "07:00 PM - 08:00 PM";
    assert.equal(checkSlotAvailability("Court 1", slot, courts, [{ ...row, open_play: true }], date), "open_play");
    assert.equal(checkSlotAvailability("Court 1", slot, courts, [row], date), "booked");
});
