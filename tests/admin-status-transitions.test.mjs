import test from "node:test";
import assert from "node:assert/strict";
import { canTransition, noShowMinutesLeft, buildStatusUpdate, gameDayBlockReason, autoCloseStatus, openPlayCloseStatus } from "../src/lib/services/bookings/adminStatusRules.ts";

test("admin status transitions: game-day statuses respect the booking's date in venue time", () => {
    const booking = { booking_date: "2026-10-25" };
    const ok = (status, at) => gameDayBlockReason(status, booking, new Date(at), "04:00") === null;
    // The business day runs from 4 AM to 4 AM (the default day_ends_at)
    for (const s of ["checked_in", "in_progress"]) {
        assert.equal(ok(s, "2026-10-25T04:00:00+08:00"), true, s);
        assert.equal(ok(s, "2026-10-25T23:59:00+08:00"), true, s);
        assert.equal(ok(s, "2026-10-26T00:30:00+08:00"), true, s); // still the 25th's late night
        assert.equal(ok(s, "2026-10-24T16:30:00Z"), false, s); // 00:30 on the 25th in Manila is the 24th's late night
        assert.equal(ok(s, "2026-10-24T23:59:00+08:00"), false, s);
        assert.equal(ok(s, "2026-10-26T04:00:00+08:00"), false, s);
        // A 1 AM booking belongs to the night before
        const late = { booking_date: "2026-10-26", start_time: "01:00:00" };
        assert.equal(gameDayBlockReason(s, late, new Date("2026-10-26T00:30:00+08:00"), "04:00"), null, s);
        assert.equal(gameDayBlockReason(s, late, new Date("2026-10-25T22:00:00+08:00"), "04:00"), null, s);
        assert.notEqual(gameDayBlockReason(s, late, new Date("2026-10-26T10:00:00+08:00"), "04:00"), null, s);
        assert.equal(gameDayBlockReason(s, { ...late, business_date: "2026-10-25" }, new Date("2026-10-26T00:30:00+08:00"), "04:00"), null, s);
    }
    assert.equal(ok("completed", "2026-10-24T23:59:00+08:00"), false); // future booking
    assert.equal(ok("completed", "2026-10-25T10:00:00+08:00"), true);
    assert.equal(ok("completed", "2026-10-27T10:00:00+08:00"), true); // closing a missed booking later
    assert.equal(ok("cancelled", "2026-10-01T10:00:00+08:00"), true);
});

test("admin status transitions: validates allowed and disallowed state machine paths", () => {
    for (const next of ["checked_in", "no_show", "cancelled"]) assert.equal(canTransition("confirmed", next), true);
    assert.equal(canTransition("checked_in", "cancelled"), true);
    assert.equal(canTransition("no_show", "completed"), true); // Mark as Played
    // Start and complete are automatic now: staff only check in
    for (const [from, to] of [["confirmed", "completed"], ["checked_in", "in_progress"], ["checked_in", "completed"]]) {
        assert.equal(canTransition(from, to), false, `${from} -> ${to}`);
    }
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

test("autoCloseStatus: closes court bookings once the slot ends, checked in or not", () => {
    const slot = { booking_date: "2026-10-25", start_time: "08:00:00", end_time: "10:00:00" };
    const at = (iso) => new Date(iso);
    assert.equal(autoCloseStatus({ ...slot, status: "checked_in" }, at("2026-10-25T09:59:00+08:00")), null);
    assert.equal(autoCloseStatus({ ...slot, status: "checked_in" }, at("2026-10-25T10:00:00+08:00")), "completed");
    assert.equal(autoCloseStatus({ ...slot, status: "in_progress" }, at("2026-10-25T10:00:00+08:00")), "completed");
    assert.equal(autoCloseStatus({ ...slot, status: "confirmed" }, at("2026-10-25T09:59:00+08:00")), null);
    assert.equal(autoCloseStatus({ ...slot, status: "confirmed" }, at("2026-10-25T10:00:00+08:00")), "no_show");
    for (const status of ["pending", "cancelled", "completed", "no_show"]) {
        assert.equal(autoCloseStatus({ ...slot, status }, at("2026-10-26T10:00:00+08:00")), null, status);
    }
    // A slot ending at midnight ends on the next day, not at the start of its own day
    const late = { booking_date: "2026-10-25", start_time: "23:00:00", end_time: "00:00:00", status: "confirmed" };
    assert.equal(autoCloseStatus(late, at("2026-10-25T23:30:00+08:00")), null);
    assert.equal(autoCloseStatus(late, at("2026-10-26T00:00:00+08:00")), "no_show");
});

test("openPlayCloseStatus: open play players are recorded as played once the session ends", () => {
    const spot = { booking_date: "2026-10-25", start_time: "18:00:00", end_time: "20:00:00" };
    const at = (iso) => new Date(iso);
    assert.equal(openPlayCloseStatus({ ...spot, status: "confirmed" }, at("2026-10-25T19:59:00+08:00")), null);
    assert.equal(openPlayCloseStatus({ ...spot, status: "confirmed" }, at("2026-10-25T20:00:00+08:00")), "completed");
    assert.equal(openPlayCloseStatus({ ...spot, status: "checked_in" }, at("2026-10-26T08:00:00+08:00")), "completed");
    assert.equal(openPlayCloseStatus({ ...spot, status: "cancelled" }, at("2026-10-26T08:00:00+08:00")), null);
    assert.equal(openPlayCloseStatus({ ...spot, status: "pending" }, at("2026-10-26T08:00:00+08:00")), null);
});
