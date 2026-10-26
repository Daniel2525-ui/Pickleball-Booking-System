import test from "node:test";
import assert from "node:assert/strict";
import {
    calculateRemainingSeconds,
    formatCountdown,
    getHoldCountdownState,
} from "../src/lib/utils/countdown.ts";

test("calculateRemainingSeconds: calculates exact seconds remaining for future timestamp", () => {
    const fixedNow = new Date("2026-10-26T12:00:00.000Z").getTime();
    const expiry = new Date("2026-10-26T12:15:30.000Z").toISOString(); // 15m 30s = 930s

    const remaining = calculateRemainingSeconds(expiry, fixedNow);
    assert.equal(remaining, 930);
});

test("calculateRemainingSeconds: returns 0 for past timestamp", () => {
    const fixedNow = new Date("2026-10-26T12:00:00.000Z").getTime();
    const pastExpiry = new Date("2026-10-26T11:59:59.000Z").toISOString();

    const remaining = calculateRemainingSeconds(pastExpiry, fixedNow);
    assert.equal(remaining, 0);
});

test("calculateRemainingSeconds: returns 0 when expiry equals current time", () => {
    const fixedNow = new Date("2026-10-26T12:00:00.000Z").getTime();
    const exactExpiry = new Date("2026-10-26T12:00:00.000Z").toISOString();

    const remaining = calculateRemainingSeconds(exactExpiry, fixedNow);
    assert.equal(remaining, 0);
});

test("calculateRemainingSeconds: handles null, undefined, and invalid date strings safely", () => {
    const fixedNow = Date.now();
    assert.equal(calculateRemainingSeconds(null, fixedNow), 0);
    assert.equal(calculateRemainingSeconds(undefined, fixedNow), 0);
    assert.equal(calculateRemainingSeconds("", fixedNow), 0);
    assert.equal(calculateRemainingSeconds("invalid-date-string", fixedNow), 0);
});

test("calculateRemainingSeconds: accepts Date object or timestamp as now", () => {
    const fixedNow = new Date("2026-10-26T12:00:00.000Z");
    const expiry = new Date("2026-10-26T12:05:00.000Z");

    assert.equal(calculateRemainingSeconds(expiry, fixedNow), 300);
});

test("formatCountdown: formats 0 and negative seconds as 00:00", () => {
    assert.equal(formatCountdown(0), "00:00");
    assert.equal(formatCountdown(-1), "00:00");
    assert.equal(formatCountdown(-999), "00:00");
    assert.equal(formatCountdown(NaN), "00:00");
});

test("formatCountdown: formats standard MM:SS with leading zero padding", () => {
    assert.equal(formatCountdown(7), "00:07");
    assert.equal(formatCountdown(59), "00:59");
    assert.equal(formatCountdown(60), "01:00");
    assert.equal(formatCountdown(65), "01:05");
    assert.equal(formatCountdown(899), "14:59");
    assert.equal(formatCountdown(900), "15:00");
    assert.equal(formatCountdown(3599), "59:59");
});

test("formatCountdown: formats durations of 1 hour or more as HH:MM:SS", () => {
    assert.equal(formatCountdown(3600), "01:00:00");
    assert.equal(formatCountdown(3665), "01:01:05");
    assert.equal(formatCountdown(7200), "02:00:00");
});

test("getHoldCountdownState: active countdown for pending booking with future expiry", () => {
    const fixedNow = new Date("2026-10-26T12:00:00.000Z").getTime();
    const expiry = new Date("2026-10-26T12:10:00.000Z").toISOString();

    const state = getHoldCountdownState(expiry, "pending", fixedNow);
    assert.equal(state.isPending, true);
    assert.equal(state.isExpired, false);
    assert.equal(state.remainingSeconds, 600);
    assert.equal(state.formatted, "10:00");
});

test("getHoldCountdownState: marks expired when pending booking is past expiry", () => {
    const fixedNow = new Date("2026-10-26T12:00:00.000Z").getTime();
    const expiry = new Date("2026-10-26T11:55:00.000Z").toISOString();

    const state = getHoldCountdownState(expiry, "pending", fixedNow);
    assert.equal(state.isPending, true);
    assert.equal(state.isExpired, true);
    assert.equal(state.remainingSeconds, 0);
    assert.equal(state.formatted, "00:00");
});

test("getHoldCountdownState: marks inactive for confirmed, completed, or cancelled bookings", () => {
    const fixedNow = new Date("2026-10-26T12:00:00.000Z").getTime();
    const futureExpiry = new Date("2026-10-26T12:30:00.000Z").toISOString();

    const confirmed = getHoldCountdownState(futureExpiry, "confirmed", fixedNow);
    assert.equal(confirmed.isPending, false);
    assert.equal(confirmed.isExpired, false);

    const cancelled = getHoldCountdownState(futureExpiry, "cancelled", fixedNow);
    assert.equal(cancelled.isPending, false);
    assert.equal(cancelled.isExpired, false);

    const completed = getHoldCountdownState(futureExpiry, "completed", fixedNow);
    assert.equal(completed.isPending, false);
    assert.equal(completed.isExpired, false);
});
