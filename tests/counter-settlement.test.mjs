import test from "node:test";
import assert from "node:assert/strict";

/**
 * Pure simulation of the counter settlement endpoint logic
 * from src/app/api/admin/payments/settle/route.ts
 */
function handleCounterSettlement({
    user,
    userRole,
    payload,
    paymentsDb,
    bookingsDb,
}) {
    // 1. Authenticate caller
    if (!user) {
        return { status: 401, error: "Unauthorized." };
    }

    // 2. Authorize admin role
    if (userRole !== "admin") {
        return { status: 403, error: "Admin access required." };
    }

    // 3. Validate request payload
    const paymentId = typeof payload?.paymentId === "string" ? payload.paymentId.trim() : "";
    const bookingId = typeof payload?.bookingId === "string" ? payload.bookingId.trim() : "";
    const paymentMethod = typeof payload?.paymentMethod === "string" ? payload.paymentMethod.trim().toLowerCase() : "";
    const paymentReference = typeof payload?.paymentReference === "string" ? payload.paymentReference.trim() : null;

    if (!paymentId || !bookingId || (paymentMethod !== "cash" && paymentMethod !== "gcash")) {
        return {
            status: 400,
            error: "paymentId, bookingId, and a valid paymentMethod ('cash' or 'gcash') are required.",
        };
    }

    // 4. Update payment row to paid (must match id, booking_id, status = 'pending')
    const payment = paymentsDb.find(
        (p) => p.id === paymentId && p.booking_id === bookingId && p.status === "pending"
    );

    if (!payment) {
        return {
            status: 409,
            error: "Payment is no longer pending or has already been settled.",
        };
    }

    const paidAt = new Date().toISOString();
    payment.status = "paid";
    payment.payment_method = paymentMethod;
    payment.payment_reference = paymentReference || null;
    payment.paid_at = paidAt;

    // 5. Confirm booking so it is protected from cleanup cron
    const booking = bookingsDb.find((b) => b.id === bookingId && b.status === "pending");
    if (booking) {
        booking.status = "confirmed";
    }

    return { status: 200, success: true, data: payment };
}

test("counter settlement: rejects unauthenticated caller with 401", () => {
    const res = handleCounterSettlement({
        user: null,
        userRole: null,
        payload: { paymentId: "p1", bookingId: "b1", paymentMethod: "cash" },
        paymentsDb: [],
        bookingsDb: [],
    });
    assert.equal(res.status, 401);
});

test("counter settlement: rejects non-admin users with 403", () => {
    for (const role of ["customer", "member", "staff", null]) {
        const res = handleCounterSettlement({
            user: { id: "user-123" },
            userRole: role,
            payload: { paymentId: "p1", bookingId: "b1", paymentMethod: "cash" },
            paymentsDb: [],
            bookingsDb: [],
        });
        assert.equal(res.status, 403);
    }
});

test("counter settlement: validates required fields and paymentMethod", () => {
    const base = {
        user: { id: "admin-1" },
        userRole: "admin",
        paymentsDb: [],
        bookingsDb: [],
    };

    // Missing paymentId
    assert.equal(
        handleCounterSettlement({ ...base, payload: { bookingId: "b1", paymentMethod: "cash" } }).status,
        400
    );

    // Missing bookingId
    assert.equal(
        handleCounterSettlement({ ...base, payload: { paymentId: "p1", paymentMethod: "cash" } }).status,
        400
    );

    // Unsupported payment method
    assert.equal(
        handleCounterSettlement({ ...base, payload: { paymentId: "p1", bookingId: "b1", paymentMethod: "card" } }).status,
        400
    );
    assert.equal(
        handleCounterSettlement({ ...base, payload: { paymentId: "p1", bookingId: "b1", paymentMethod: "" } }).status,
        400
    );
});

test("counter settlement: successfully settles pending payment with cash or gcash", () => {
    const payments = [
        { id: "pay-1", booking_id: "bk-1", status: "pending", amount: 400 },
    ];
    const bookings = [
        { id: "bk-1", status: "pending", total_amount: 400 },
    ];

    const res = handleCounterSettlement({
        user: { id: "admin-1" },
        userRole: "admin",
        payload: {
            paymentId: "pay-1",
            bookingId: "bk-1",
            paymentMethod: "GCASH",
            paymentReference: "GCASH-REF-9988",
        },
        paymentsDb: payments,
        bookingsDb: bookings,
    });

    assert.equal(res.status, 200);
    assert.equal(payments[0].status, "paid");
    assert.equal(payments[0].payment_method, "gcash");
    assert.equal(payments[0].payment_reference, "GCASH-REF-9988");
    assert.ok(payments[0].paid_at);
    assert.equal(bookings[0].status, "confirmed");
});

test("counter settlement: rejects already settled or non-pending payment with 409", () => {
    const payments = [
        { id: "pay-1", booking_id: "bk-1", status: "paid", amount: 400 },
    ];
    const bookings = [
        { id: "bk-1", status: "confirmed", total_amount: 400 },
    ];

    const res = handleCounterSettlement({
        user: { id: "admin-1" },
        userRole: "admin",
        payload: {
            paymentId: "pay-1",
            bookingId: "bk-1",
            paymentMethod: "cash",
        },
        paymentsDb: payments,
        bookingsDb: bookings,
    });

    assert.equal(res.status, 409);
    assert.match(res.error, /already been settled/);
});
