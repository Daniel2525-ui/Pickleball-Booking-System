import test from "node:test";
import assert from "node:assert/strict";

/**
 * State machine and grace period logic from src/app/api/admin/bookings/status/route.ts.
 */
const ALLOWED_TRANSITIONS = {
    pending: ["cancelled"],
    confirmed: ["checked_in", "no_show", "completed", "cancelled"],
    checked_in: ["in_progress", "completed", "cancelled"],
    in_progress: ["completed", "cancelled"],
};

const NO_SHOW_GRACE_MINUTES = 15;

function validateStatusTransition(currentStatus, targetStatus) {
    const allowed = ALLOWED_TRANSITIONS[currentStatus.toLowerCase()] ?? [];
    return allowed.includes(targetStatus.toLowerCase());
}

function evaluateNoShowGracePeriod(bookingDate, startTime, now) {
    const venueOffset = "+08:00";
    const time = startTime.length === 5 ? `${startTime}:00` : startTime.slice(0, 8);
    const bookingStart = new Date(`${bookingDate}T${time}${venueOffset}`);
    const graceCutoff = new Date(bookingStart.getTime() + NO_SHOW_GRACE_MINUTES * 60_000);

    if (now < graceCutoff) {
        const minutesLeft = Math.ceil((graceCutoff.getTime() - now.getTime()) / 60_000);
        return {
            allowed: false,
            minutesLeft,
            error: `No-show grace period has not elapsed. ${minutesLeft} minute(s) remaining.`,
        };
    }

    return { allowed: true };
}

function buildStatusUpdatePayload(newStatus, now = new Date().toISOString()) {
    const updatePayload = {
        status: newStatus,
    };

    if (newStatus === "checked_in") updatePayload.checked_in_at = now;
    if (newStatus === "in_progress") updatePayload.started_at = now;
    if (newStatus === "completed") updatePayload.completed_at = now;
    if (newStatus === "no_show") updatePayload.no_show_at = now;

    return updatePayload;
}

test("admin status transitions: validates allowed and disallowed state machine paths", () => {
    // Allowed from confirmed
    assert.equal(validateStatusTransition("confirmed", "checked_in"), true);
    assert.equal(validateStatusTransition("confirmed", "completed"), true);
    assert.equal(validateStatusTransition("confirmed", "no_show"), true);
    assert.equal(validateStatusTransition("confirmed", "cancelled"), true);

    // Allowed from checked_in
    assert.equal(validateStatusTransition("checked_in", "in_progress"), true);
    assert.equal(validateStatusTransition("checked_in", "completed"), true);
    assert.equal(validateStatusTransition("checked_in", "cancelled"), true);

    // Allowed from in_progress
    assert.equal(validateStatusTransition("in_progress", "completed"), true);
    assert.equal(validateStatusTransition("in_progress", "cancelled"), true);

    // Allowed from pending
    assert.equal(validateStatusTransition("pending", "cancelled"), true);

    // Disallowed: pending cannot jump directly to game-day statuses
    assert.equal(validateStatusTransition("pending", "checked_in"), false);
    assert.equal(validateStatusTransition("pending", "in_progress"), false);
    assert.equal(validateStatusTransition("pending", "completed"), false);

    // Disallowed: backward or terminal transitions
    assert.equal(validateStatusTransition("completed", "confirmed"), false);
    assert.equal(validateStatusTransition("completed", "in_progress"), false);
    assert.equal(validateStatusTransition("cancelled", "confirmed"), false);
    assert.equal(validateStatusTransition("no_show", "confirmed"), false);
    assert.equal(validateStatusTransition("no_show", "in_progress"), false);
    assert.equal(validateStatusTransition("checked_in", "confirmed"), false);
    assert.equal(validateStatusTransition("in_progress", "checked_in"), false);
});

test("admin status transitions: enforces 15-minute grace period before no-show is permitted", () => {
    const bookingDate = "2026-10-25";
    const startTime = "08:00:00"; // 08:00:00+08:00

    // 1. Before game starts (07:55:00+08:00) -> BLOCKED (20 mins left)
    const beforeStart = new Date("2026-10-25T07:55:00+08:00");
    const checkBefore = evaluateNoShowGracePeriod(bookingDate, startTime, beforeStart);
    assert.equal(checkBefore.allowed, false);
    assert.equal(checkBefore.minutesLeft, 20);

    // 2. 10 minutes after game starts (08:10:00+08:00) -> BLOCKED (5 mins left)
    const tenMinsIn = new Date("2026-10-25T08:10:00+08:00");
    const checkTen = evaluateNoShowGracePeriod(bookingDate, startTime, tenMinsIn);
    assert.equal(checkTen.allowed, false);
    assert.equal(checkTen.minutesLeft, 5);

    // 3. Exactly 15 minutes after (08:15:00+08:00) -> ALLOWED
    const fifteenMinsIn = new Date("2026-10-25T08:15:00+08:00");
    const checkFifteen = evaluateNoShowGracePeriod(bookingDate, startTime, fifteenMinsIn);
    assert.equal(checkFifteen.allowed, true);

    // 4. 30 minutes after (08:30:00+08:00) -> ALLOWED
    const thirtyMinsIn = new Date("2026-10-25T08:30:00+08:00");
    const checkThirty = evaluateNoShowGracePeriod(bookingDate, startTime, thirtyMinsIn);
    assert.equal(checkThirty.allowed, true);
});

test("admin status transitions: populates appropriate Stage 2 audit timestamps per status", () => {
    const testNow = "2026-10-25T08:15:00.000Z";

    // 1. checked_in generates checked_in_at
    const p1 = buildStatusUpdatePayload("checked_in", testNow);
    assert.equal(p1.status, "checked_in");
    assert.equal(p1.checked_in_at, testNow);
    assert.equal(p1.started_at, undefined);

    // 2. in_progress generates started_at
    const p2 = buildStatusUpdatePayload("in_progress", testNow);
    assert.equal(p2.status, "in_progress");
    assert.equal(p2.started_at, testNow);
    assert.equal(p2.completed_at, undefined);

    // 3. completed generates completed_at
    const p3 = buildStatusUpdatePayload("completed", testNow);
    assert.equal(p3.status, "completed");
    assert.equal(p3.completed_at, testNow);

    // 4. no_show preserves distinct no_show status and generates no_show_at
    const p4 = buildStatusUpdatePayload("no_show", testNow);
    assert.equal(p4.status, "no_show");
    assert.equal(p4.no_show_at, testNow);
});

test("court occupancy logic: marks courts occupied for in_progress and active time windows", () => {
    const isCourtOccupied = (booking, currentTime) => {
        if (booking.status === "in_progress") return true;
        if (booking.status === "confirmed" || booking.status === "checked_in") {
            return booking.start_time <= currentTime && booking.end_time > currentTime;
        }
        return false;
    };

    const court1Booking = { status: "in_progress", start_time: "10:00:00", end_time: "11:00:00" };
    // in_progress is occupied even if currentTime is slightly before scheduled start (early start)
    assert.equal(isCourtOccupied(court1Booking, "09:55:00"), true);
    // in_progress is occupied during scheduled time
    assert.equal(isCourtOccupied(court1Booking, "10:30:00"), true);

    // confirmed booking only occupies during scheduled time
    const court2Booking = { status: "confirmed", start_time: "14:00:00", end_time: "15:00:00" };
    assert.equal(isCourtOccupied(court2Booking, "13:30:00"), false);
    assert.equal(isCourtOccupied(court2Booking, "14:15:00"), true);
    assert.equal(isCourtOccupied(court2Booking, "15:00:00"), false);

    // completed and no_show never occupy court
    assert.equal(isCourtOccupied({ status: "completed", start_time: "10:00:00", end_time: "11:00:00" }, "10:30:00"), false);
    assert.equal(isCourtOccupied({ status: "no_show", start_time: "10:00:00", end_time: "11:00:00" }, "10:30:00"), false);
});

