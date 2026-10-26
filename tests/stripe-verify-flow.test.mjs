import test from "node:test";
import assert from "node:assert/strict";

/**
 * Pure simulation of the /api/stripe/verify processing logic
 * as implemented in src/app/api/stripe/verify/route.ts.
 */
function processVerifySession({
    session,
    existingBooking,
    existingConflicts,
    stripeRefundsMock,
    paymentsTableMock,
    bookingsTableMock,
}) {
    if (!session || !session.id) {
        return { status: 400, error: "Missing session ID" };
    }

    const bookingId = session.metadata?.booking_id;
    const paymentId = session.metadata?.payment_id;

    if (!bookingId || !paymentId) {
        return { status: 400, error: "Missing metadata" };
    }

    if (session.payment_status !== "paid" && session.status !== "complete") {
        return {
            status: 400,
            success: false,
            error: "Payment was not completed. Your reservation hold has not been confirmed.",
        };
    }

    if (!existingBooking) {
        return { status: 404, error: "Booking not found" };
    }

    if (existingBooking.status === "pending") {
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
            if (session.payment_intent && stripeRefundsMock) {
                stripeRefundsMock.create({ payment_intent: session.payment_intent });
            }

            paymentsTableMock.update({
                status: "refunded",
                stripe_payment_id: session.payment_intent || null,
            });

            bookingsTableMock.update({ status: "cancelled" });

            return {
                status: 200,
                success: false,
                conflict: true,
                error: "This slot was booked by another player. A full refund has been initiated.",
            };
        }

        paymentsTableMock.update({
            status: "paid",
            stripe_payment_id: session.payment_intent || null,
            paid_at: new Date().toISOString(),
        });

        bookingsTableMock.update({ status: "confirmed" });
    }

    return { status: 200, success: true, payment_status: session.payment_status };
}

test("Stripe verify: rejects unpaid or incomplete checkout sessions", () => {
    const res = processVerifySession({
        session: {
            id: "cs_unpaid_1",
            payment_status: "unpaid",
            status: "open",
            metadata: { booking_id: "book-1", payment_id: "pay-1" },
        },
        existingBooking: { id: "book-1", status: "pending" },
        existingConflicts: [],
        stripeRefundsMock: { create: () => {} },
        paymentsTableMock: { update: () => {} },
        bookingsTableMock: { update: () => {} },
    });

    assert.equal(res.status, 400);
    assert.equal(res.success, false);
    assert.match(res.error, /Payment was not completed/);
});

test("Stripe verify: confirms pending booking and payment when paid", () => {
    let paymentUpdate = null;
    let bookingUpdate = null;

    const res = processVerifySession({
        session: {
            id: "cs_paid_1",
            payment_status: "paid",
            status: "complete",
            payment_intent: "pi_verified_99",
            metadata: { booking_id: "book-1", payment_id: "pay-1" },
        },
        existingBooking: {
            id: "book-1",
            court_id: "court-1",
            booking_date: "2026-10-26",
            start_time: "08:00:00",
            end_time: "09:00:00",
            status: "pending",
        },
        existingConflicts: [],
        stripeRefundsMock: { create: () => {} },
        paymentsTableMock: { update: (u) => { paymentUpdate = u; } },
        bookingsTableMock: { update: (u) => { bookingUpdate = u; } },
    });

    assert.equal(res.status, 200);
    assert.equal(res.success, true);
    assert.equal(paymentUpdate.status, "paid");
    assert.equal(paymentUpdate.stripe_payment_id, "pi_verified_99");
    assert.equal(bookingUpdate.status, "confirmed");
});

test("Stripe verify: detects double-booking conflict, refunds payment and cancels hold", () => {
    let refundedIntent = null;
    let paymentUpdate = null;
    let bookingUpdate = null;

    const res = processVerifySession({
        session: {
            id: "cs_conflict_1",
            payment_status: "paid",
            status: "complete",
            payment_intent: "pi_refund_conflict",
            metadata: { booking_id: "book-late", payment_id: "pay-late" },
        },
        existingBooking: {
            id: "book-late",
            court_id: "court-1",
            booking_date: "2026-10-26",
            start_time: "08:00:00",
            end_time: "09:00:00",
            status: "pending",
        },
        existingConflicts: [
            {
                id: "book-winner",
                court_id: "court-1",
                booking_date: "2026-10-26",
                start_time: "08:00:00",
                end_time: "09:00:00",
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
    assert.equal(res.success, false);
    assert.equal(res.conflict, true);
    assert.equal(refundedIntent, "pi_refund_conflict");
    assert.equal(paymentUpdate.status, "refunded");
    assert.equal(bookingUpdate.status, "cancelled");
});

test("Stripe verify: rejects reconciliation with 500 when service-role key is missing", () => {
    function verifyServiceRoleGuard(serviceRoleKey) {
        if (!serviceRoleKey || serviceRoleKey.trim() === "") {
            return {
                status: 500,
                error: "Server configuration error: payment reconciliation service key missing",
            };
        }
        return { status: 200, ok: true };
    }

    assert.equal(verifyServiceRoleGuard(undefined).status, 500);
    assert.equal(verifyServiceRoleGuard("").status, 500);
    assert.equal(verifyServiceRoleGuard("   ").status, 500);
    assert.equal(verifyServiceRoleGuard("valid_key").status, 200);
});
