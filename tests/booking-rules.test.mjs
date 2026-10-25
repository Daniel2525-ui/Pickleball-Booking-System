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

// 2. Cancellation eligibility rules test
const customerCancellableStatuses = ["pending", "confirmed"];
const venueUtcOffset = "+08:00";

const getBookingStart = (booking) => {
    const time = booking.start_time.length === 5 ? `${booking.start_time}:00` : booking.start_time.slice(0, 8);
    return new Date(`${booking.booking_date}T${time}${venueUtcOffset}`);
};

const getCancellationBlockReason = (booking, now = new Date()) => {
    const status = (booking.status || "").toLowerCase();
    if (status === "cancelled") return "This booking has already been cancelled.";
    if (!customerCancellableStatuses.includes(status)) {
        return `Bookings with status "${booking.status}" can no longer be cancelled.`;
    }
    const start = getBookingStart(booking);
    if (Number.isNaN(start.getTime())) return "This booking has an invalid date or time.";
    if (start <= now) return "This booking has already started and can no longer be cancelled.";
    return null;
};

test("cancellation policy permits future confirmed/pending bookings", () => {
    const futureBooking = {
        status: "confirmed",
        booking_date: "2099-01-01",
        start_time: "10:00:00",
    };
    assert.equal(getCancellationBlockReason(futureBooking), null);

    const pendingBooking = {
        status: "pending",
        booking_date: "2099-01-01",
        start_time: "10:00:00",
    };
    assert.equal(getCancellationBlockReason(pendingBooking), null);
});

test("cancellation policy blocks past or completed bookings", () => {
    const pastBooking = {
        status: "confirmed",
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
