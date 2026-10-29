import test from "node:test";
import assert from "node:assert/strict";
import { getBookingDisplayStatus, isHoldExpired, cancelReasonFor } from "../src/lib/services/bookings/bookingDisplayStatus.ts";

const now = new Date("2026-10-29T10:00:00Z");
const booking = (fields) => ({ status: "pending", created_at: "2026-10-29T09:50:00Z", hold_expires_at: null, cancel_reason: null, ...fields });

test("pending hold: active until its expiry, 'hold_expired' from the expiry instant", () => {
    assert.equal(getBookingDisplayStatus(booking({ hold_expires_at: "2026-10-29T10:00:01Z" }), now), "pending");
    assert.equal(getBookingDisplayStatus(booking({ hold_expires_at: "2026-10-29T10:00:00Z" }), now), "hold_expired");
    // No hold_expires_at: same 35-minute fallback as the database
    assert.equal(isHoldExpired(booking({ created_at: "2026-10-29T09:25:01Z" }), now), false);
    assert.equal(isHoldExpired(booking({ created_at: "2026-10-29T09:25:00Z" }), now), true);
});

test("cancelled: 'expired' only when cleanup recorded expiry; other reasons stay 'cancelled'", () => {
    assert.equal(getBookingDisplayStatus(booking({ status: "cancelled", cancel_reason: "expired" }), now), "expired");
    for (const reason of ["customer", "admin", "slot_conflict", null]) {
        assert.equal(getBookingDisplayStatus(booking({ status: "cancelled", cancel_reason: reason }), now), "cancelled");
    }
});

test("cancelReasonFor: a timed-out hold is 'expired' whoever cancels it", () => {
    const stale = booking({ hold_expires_at: "2026-10-29T09:59:00Z" });
    const live = booking({ hold_expires_at: "2026-10-29T10:05:00Z" });
    assert.equal(cancelReasonFor(stale, "customer", now), "expired");
    assert.equal(cancelReasonFor(stale, "admin", now), "expired");
    assert.equal(cancelReasonFor(live, "customer", now), "customer");
    assert.equal(cancelReasonFor(booking({ status: "confirmed" }), "customer", now), "customer");
});

test("non-pending bookings are never treated as expired holds", () => {
    for (const status of ["confirmed", "checked_in", "completed", "no_show"]) {
        assert.equal(getBookingDisplayStatus(booking({ status, hold_expires_at: "2026-10-29T09:00:00Z" }), now), status);
    }
});
