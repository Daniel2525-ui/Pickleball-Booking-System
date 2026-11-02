import test from "node:test";
import assert from "node:assert/strict";
import { getBookingDisplayStatus, isHoldExpired, cancelReasonFor, cancellationNote } from "../src/lib/services/bookings/bookingDisplayStatus.ts";

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

test("awaiting verification: infinite hold is never expired and shows its own status", () => {
    const awaiting = booking({ hold_expires_at: "infinity" });
    assert.equal(getBookingDisplayStatus(awaiting, now), "awaiting_verification");
    assert.equal(isHoldExpired(awaiting, now), false);
});

test("cancellationNote: who cancelled and what happened to the money", () => {
    const pay = (status, payment_method = "stripe") => ({ status, payment_method });
    const cancelled = (cancel_reason, payments) => ({ status: "cancelled", cancel_reason, payments });
    assert.equal(cancellationNote({ status: "confirmed", payments: [pay("paid")] }), null);
    assert.deepEqual(cancellationNote(cancelled("customer", [pay("refunded")])), { text: "Refunded", charged: true });
    assert.deepEqual(cancellationNote(cancelled("admin", [pay("paid")])), { text: "Cancelled by the venue · Refund on its way to your card", charged: true });
    assert.deepEqual(cancellationNote(cancelled("admin", [pay("paid", "cash")])), { text: "Cancelled by the venue · The venue will refund you at the counter", charged: true });
    assert.deepEqual(cancellationNote(cancelled("admin", [pay("paid", "gcash")])), { text: "Cancelled by the venue · The venue will refund you at the counter", charged: true });
    // An expired or abandoned hold was never paid
    assert.deepEqual(cancellationNote(cancelled("expired", [pay("failed")])), { text: "Not charged", charged: false });
    assert.deepEqual(cancellationNote(cancelled("customer", [])), { text: "Not charged", charged: false });
    // Money still out beats an earlier refund (a duplicate charge being refunded)
    assert.deepEqual(cancellationNote(cancelled("customer", [pay("refunded"), pay("paid")])), { text: "Refund on its way to your card", charged: true });
    assert.deepEqual(cancellationNote(cancelled("gcash_rejected", [pay("failed", "gcash")])), { text: "GCash payment could not be verified", charged: false });
});
