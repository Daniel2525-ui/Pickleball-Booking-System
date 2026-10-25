import test from "node:test";
import assert from "node:assert/strict";

/**
 * State machine and grace period logic from src/app/api/admin/bookings/status/route.ts.
 */
const ALLOWED_TRANSITIONS = {
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

function resolveDbStatus(targetStatus) {
    // shortcut: map no_show to cancelled until stage 2 migration adds no_show enum, upgrade when stage 2 deployed
    if (targetStatus === "no_show") return "cancelled";
    return targetStatus;
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

    // Disallowed: backward or terminal transitions
    assert.equal(validateStatusTransition("completed", "confirmed"), false);
    assert.equal(validateStatusTransition("completed", "in_progress"), false);
    assert.equal(validateStatusTransition("cancelled", "confirmed"), false);
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

test("admin status transitions: maps no_show to cancelled in database to release court slot", () => {
    assert.equal(resolveDbStatus("no_show"), "cancelled");
    assert.equal(resolveDbStatus("completed"), "completed");
    assert.equal(resolveDbStatus("cancelled"), "cancelled");
});
