import test from "node:test";
import assert from "node:assert/strict";
import { canTransition, noShowMinutesLeft, buildStatusUpdate } from "../src/lib/services/bookings/adminStatusRules.ts";

test("admin status transitions: validates allowed and disallowed state machine paths", () => {
    for (const next of ["checked_in", "completed", "no_show", "cancelled"]) assert.equal(canTransition("confirmed", next), true);
    for (const next of ["in_progress", "completed", "cancelled"]) assert.equal(canTransition("checked_in", next), true);
    for (const next of ["completed", "cancelled"]) assert.equal(canTransition("in_progress", next), true);
    assert.equal(canTransition("pending", "cancelled"), true);

    // Pending cannot jump to game-day statuses; terminal and backward moves are refused
    for (const next of ["checked_in", "in_progress", "completed"]) assert.equal(canTransition("pending", next), false);
    for (const [from, to] of [["completed", "confirmed"], ["completed", "in_progress"], ["cancelled", "confirmed"],
        ["no_show", "confirmed"], ["no_show", "in_progress"], ["checked_in", "confirmed"], ["in_progress", "checked_in"]]) {
        assert.equal(canTransition(from, to), false, `${from} -> ${to}`);
    }
});

test("admin status transitions: enforces 15-minute grace period before no-show is permitted", () => {
    const booking = { booking_date: "2026-10-25", start_time: "08:00:00" }; // venue time (+08:00)
    assert.equal(noShowMinutesLeft(booking, new Date("2026-10-25T07:55:00+08:00")), 20);
    assert.equal(noShowMinutesLeft(booking, new Date("2026-10-25T08:10:00+08:00")), 5);
    assert.equal(noShowMinutesLeft(booking, new Date("2026-10-25T08:15:00+08:00")), 0);
    assert.equal(noShowMinutesLeft(booking, new Date("2026-10-25T08:30:00+08:00")), 0);
});

test("admin status transitions: populates appropriate Stage 2 audit timestamps per status", () => {
    const now = new Date("2026-10-25T08:15:00.000Z");
    const at = now.toISOString();
    assert.deepEqual(buildStatusUpdate("checked_in", undefined, now), { status: "checked_in", checked_in_at: at });
    assert.deepEqual(buildStatusUpdate("in_progress", undefined, now), { status: "in_progress", started_at: at });
    assert.deepEqual(buildStatusUpdate("completed", undefined, now), { status: "completed", completed_at: at });
    assert.deepEqual(buildStatusUpdate("no_show", undefined, now), { status: "no_show", no_show_at: at });
});

test("admin status transitions: cancelling a hold that already timed out records 'expired', anything else 'admin'", () => {
    const now = new Date("2026-10-25T08:15:00.000Z");
    const hold = (hold_expires_at) => ({ status: "pending", created_at: "2026-10-25T07:30:00.000Z", hold_expires_at });
    assert.equal(buildStatusUpdate("cancelled", hold("2026-10-25T08:14:59.000Z"), now).cancel_reason, "expired");
    assert.equal(buildStatusUpdate("cancelled", hold("2026-10-25T08:30:00.000Z"), now).cancel_reason, "admin");
    assert.equal(buildStatusUpdate("cancelled", { status: "confirmed", created_at: "2026-10-24T00:00:00Z", hold_expires_at: null }, now).cancel_reason, "admin");
});
