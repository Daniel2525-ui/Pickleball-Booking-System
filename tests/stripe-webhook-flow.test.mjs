import test from "node:test";
import assert from "node:assert/strict";

/**
 * Pure simulation of the Stripe webhook checkout.session.completed processing logic
 * as implemented in src/app/api/stripe/webhook/route.ts.
 */
function processCheckoutSessionCompleted({
    session,
    existingBooking,
    existingConflicts,
    stripeRefundsMock,
    paymentsTableMock,
    bookingsTableMock,
}) {
    const bookingId = session.metadata?.booking_id;
    if (!bookingId) {
        return { status: 400, error: "Missing booking_id in session metadata" };
    }

    if (!existingBooking) {
        return { status: 404, error: "Booking not found" };
    }

    // Idempotency: skip if already processed / not pending
    if (existingBooking.status !== "pending") {
        return { status: 200, action: "skipped", reason: "already_processed" };
    }

    // Conflict detection includes active confirmed match statuses (not unpaid pending holds)
    const ACTIVE_CONFLICT_STATUSES = ["confirmed", "completed", "checked_in", "in_progress"];
    const hasConflict = existingConflicts.some(
        (c) =>
            c.id !== existingBooking.id &&
            c.court_id === existingBooking.court_id &&
            c.booking_date === existingBooking.booking_date &&
            ACTIVE_CONFLICT_STATUSES.includes(c.status) &&
            c.start_time < existingBooking.end_time &&
            c.end_time > existingBooking.start_time
    );

    if (hasConflict) {
        // Trigger automated refund
        if (session.payment_intent && stripeRefundsMock) {
            stripeRefundsMock.create({ payment_intent: session.payment_intent });
        }

        paymentsTableMock.update({
            status: "refunded",
            payment_reference: session.payment_intent || null,
        });

        bookingsTableMock.update({ status: "cancelled" });

        return { status: 200, action: "refunded_due_to_conflict" };
    }

    // Happy path: confirm payment and booking
    paymentsTableMock.update({
        status: "paid",
        payment_reference: session.payment_intent || null,
        paid_at: new Date().toISOString(),
    });

    bookingsTableMock.update({ status: "confirmed" });

    return { status: 200, action: "confirmed" };
}

test("Stripe webhook: confirms pending booking when no conflict exists", () => {
    let paymentUpdate = null;
    let bookingUpdate = null;

    const res = processCheckoutSessionCompleted({
        session: {
            metadata: { booking_id: "book-1" },
            payment_intent: "pi_12345",
        },
        existingBooking: {
            id: "book-1",
            court_id: "court-a",
            booking_date: "2026-10-25",
            start_time: "08:00:00",
            end_time: "10:00:00",
            status: "pending",
        },
        existingConflicts: [],
        stripeRefundsMock: { create: () => {} },
        paymentsTableMock: { update: (u) => { paymentUpdate = u; } },
        bookingsTableMock: { update: (u) => { bookingUpdate = u; } },
    });

    assert.equal(res.status, 200);
    assert.equal(res.action, "confirmed");
    assert.equal(paymentUpdate.status, "paid");
    assert.equal(paymentUpdate.payment_reference, "pi_12345");
    assert.equal(bookingUpdate.status, "confirmed");
});

test("Stripe webhook: idempotency skips re-processing if booking is already confirmed", () => {
    let paymentUpdated = false;
    let bookingUpdated = false;

    const res = processCheckoutSessionCompleted({
        session: {
            metadata: { booking_id: "book-1" },
            payment_intent: "pi_12345",
        },
        existingBooking: {
            id: "book-1",
            status: "confirmed", // Already confirmed from earlier event
        },
        existingConflicts: [],
        stripeRefundsMock: { create: () => {} },
        paymentsTableMock: { update: () => { paymentUpdated = true; } },
        bookingsTableMock: { update: () => { bookingUpdated = true; } },
    });

    assert.equal(res.status, 200);
    assert.equal(res.action, "skipped");
    assert.equal(paymentUpdated, false);
    assert.equal(bookingUpdated, false);
});

test("Stripe webhook: detects conflict with confirmed booking, triggers refund and cancels booking", () => {
    let refundedIntent = null;
    let paymentUpdate = null;
    let bookingUpdate = null;

    const res = processCheckoutSessionCompleted({
        session: {
            metadata: { booking_id: "book-2" },
            payment_intent: "pi_conflict_999",
        },
        existingBooking: {
            id: "book-2",
            court_id: "court-a",
            booking_date: "2026-10-25",
            start_time: "09:00:00",
            end_time: "11:00:00",
            status: "pending",
        },
        // Confirmed booking exists in overlapping interval
        existingConflicts: [
            {
                id: "book-1",
                court_id: "court-a",
                booking_date: "2026-10-25",
                start_time: "08:00:00",
                end_time: "10:00:00",
                status: "confirmed",
            },
        ],
        stripeRefundsMock: {
            create: ({ payment_intent }) => {
                refundedIntent = payment_intent;
            },
        },
        paymentsTableMock: { update: (u) => { paymentUpdate = u; } },
        bookingsTableMock: { update: (u) => { bookingUpdate = u; } },
    });

    assert.equal(res.status, 200);
    assert.equal(res.action, "refunded_due_to_conflict");
    assert.equal(refundedIntent, "pi_conflict_999");
    assert.equal(paymentUpdate.status, "refunded");
    assert.equal(bookingUpdate.status, "cancelled");
});

test("Stripe webhook: does not refund when overlapping hold is only unpaid pending", () => {
    let paymentUpdate = null;
    let bookingUpdate = null;

    const res = processCheckoutSessionCompleted({
        session: {
            metadata: { booking_id: "book-2" },
            payment_intent: "pi_paid_winner",
        },
        existingBooking: {
            id: "book-2",
            court_id: "court-a",
            booking_date: "2026-10-25",
            start_time: "09:00:00",
            end_time: "11:00:00",
            status: "pending",
        },
        // Stale un-paid pending hold should not block this paid booking
        existingConflicts: [
            {
                id: "book-old-pending",
                court_id: "court-a",
                booking_date: "2026-10-25",
                start_time: "08:00:00",
                end_time: "10:00:00",
                status: "pending",
            },
        ],
        stripeRefundsMock: { create: () => {} },
        paymentsTableMock: { update: (u) => { paymentUpdate = u; } },
        bookingsTableMock: { update: (u) => { bookingUpdate = u; } },
    });

    assert.equal(res.status, 200);
    assert.equal(res.action, "confirmed");
    assert.equal(paymentUpdate.status, "paid");
    assert.equal(bookingUpdate.status, "confirmed");
});
