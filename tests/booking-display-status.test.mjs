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

test("cancellationNote: a card refund that failed or stalled at Stripe says so", () => {
    const paid = [{ status: "paid", payment_method: "stripe" }];
    const note = (refund_status, cancel_reason = "customer") => cancellationNote({ status: "cancelled", cancel_reason, payments: paid, refund_status }).text;
    assert.equal(note("failed"), "Refund failed · The venue will contact you");
    assert.equal(note("requires_admin_review", "admin"), "Cancelled by the venue · Refund delayed · The venue is checking it");
    assert.equal(note("processing"), "Refund on its way to your card");
    assert.equal(note(null), "Refund on its way to your card");
    // Once Stripe confirms, the payment is refunded whatever the old request said
    assert.equal(cancellationNote({ status: "cancelled", cancel_reason: "customer", payments: [{ status: "refunded", payment_method: "stripe" }], refund_status: "failed" }).text, "Refunded");
});

test("checked in: shown as in progress only while the slot runs", () => {
    const b = { status: "checked_in", booking_date: "2026-10-25", start_time: "08:00:00", end_time: "09:00:00" };
    assert.equal(getBookingDisplayStatus(b, new Date("2026-10-25T07:50:00+08:00")), "checked_in"); // arrived early
    assert.equal(getBookingDisplayStatus(b, new Date("2026-10-25T08:00:00+08:00")), "in_progress");
    assert.equal(getBookingDisplayStatus(b, new Date("2026-10-25T09:00:00+08:00")), "checked_in"); // until the cron completes it
    assert.equal(getBookingDisplayStatus({ ...b, status: "confirmed" }, new Date("2026-10-25T08:30:00+08:00")), "confirmed");
});

test("open play court block follows the clock; spot rows and cancelled blocks do not", () => {
    const block = { status: "confirmed", court_id: "c1", open_play_session_id: "s1", open_play_spots: null, booking_date: "2026-10-25", start_time: "08:00:00", end_time: "10:00:00" };
    const at = (t) => new Date(`2026-10-25T${t}+08:00`);
    assert.equal(getBookingDisplayStatus(block, at("07:59:59")), "confirmed");
    assert.equal(getBookingDisplayStatus(block, at("08:00:00")), "in_progress");
    assert.equal(getBookingDisplayStatus(block, at("10:00:00")), "completed");
    // A player's spot row has no court and must stay as stored (check-in / no-show are real for players)
    assert.equal(getBookingDisplayStatus({ ...block, court_id: null, open_play_spots: 2 }, at("10:00:00")), "confirmed");
    assert.equal(getBookingDisplayStatus({ ...block, status: "cancelled" }, at("09:00:00")), "cancelled");
});
