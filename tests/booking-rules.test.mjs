import test from "node:test";
import assert from "node:assert/strict";

// 1. Time conversion test
const to24h = (time12h) => {
    const match = time12h.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!match) return time12h;
    let hours = Number(match[1]);
    const minutes = match[2];
    const period = match[3].toUpperCase();
    if (period === "PM" && hours < 12) hours += 12;
    if (period === "AM" && hours === 12) hours = 0;
    return `${String(hours).padStart(2, "0")}:${minutes}`;
};

test("to24h converts 12h times accurately", () => {
    assert.equal(to24h("08:00 AM"), "08:00");
    assert.equal(to24h("12:00 PM"), "12:00");
    assert.equal(to24h("12:00 AM"), "00:00");
    assert.equal(to24h("01:30 PM"), "13:30");
    assert.equal(to24h("11:59 PM"), "23:59");
});

// 2. Cancellation eligibility rules test (the real shared rule used by the UI and /api/bookings/cancel)
import { getCancellationBlockReason } from "../src/lib/services/bookings/cancelBooking.service.ts";

test("paid bookings are non-refundable; unpaid holds can be released until start", () => {
    const booking = (status) => ({ status, booking_date: "2026-11-01", start_time: "10:00:00" }); // 02:00Z
    const at = (iso) => new Date(iso);

    assert.match(getCancellationBlockReason(booking("confirmed"), at("2026-10-01T00:00:00Z")), /non-refundable/);
    assert.equal(getCancellationBlockReason(booking("pending"), at("2026-11-01T01:59:00Z")), null);
    assert.match(getCancellationBlockReason(booking("pending"), at("2026-11-01T02:00:00Z")), /already started/);
});

test("cancellation policy blocks past or completed bookings", () => {
    const pastBooking = {
        status: "pending",
        booking_date: "2020-01-01",
        start_time: "08:00:00",
    };
    assert.match(getCancellationBlockReason(pastBooking), /already started/);

    const completedBooking = {
        status: "completed",
        booking_date: "2099-01-01",
        start_time: "10:00:00",
    };
    assert.match(getCancellationBlockReason(completedBooking), /can no longer be cancelled/);
});

test("slot collision calculation detects interval overlaps correctly", () => {
    const overlaps = (startA, endA, startB, endB) => startA < endB && endA > startB;

    // Direct overlap: 08:00-09:00 vs 08:30-09:30
    assert.equal(overlaps("08:00", "09:00", "08:30", "09:30"), true);
    // Back-to-back: 08:00-09:00 vs 09:00-10:00 (no collision)
    assert.equal(overlaps("08:00", "09:00", "09:00", "10:00"), false);
    // Completely contained: 08:00-10:00 vs 08:30-09:30
    assert.equal(overlaps("08:00", "10:00", "08:30", "09:30"), true);
});

test("slot availability ignores expired pending holds and keeps unexpired holds pending", () => {
    const filterActiveBookings = (bookings, now = new Date()) => {
        return bookings.filter((b) => {
            const status = (b.status || "").toLowerCase();
            if (status !== "pending") return true;
            return !b.hold_expires_at || new Date(b.hold_expires_at) > now;
        });
    };

    const pastExpiry = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const futureExpiry = new Date(Date.now() + 25 * 60 * 1000).toISOString();

    const testBookings = [
        { id: "expired-hold", status: "pending", hold_expires_at: pastExpiry },
        { id: "active-hold", status: "pending", hold_expires_at: futureExpiry },
        { id: "confirmed-booking", status: "confirmed", hold_expires_at: null },
    ];

    const active = filterActiveBookings(testBookings);
    assert.equal(active.length, 2);
    assert.equal(active.some((b) => b.id === "expired-hold"), false);
    assert.equal(active.some((b) => b.id === "active-hold"), true);
    assert.equal(active.some((b) => b.id === "confirmed-booking"), true);
});

