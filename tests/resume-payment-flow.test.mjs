import test from "node:test";
import assert from "node:assert/strict";

/**
 * Pure simulation of the resume-payment route logic
 * from src/app/api/bookings/resume-payment/route.ts
 */
function handleResumePayment({
    user,
    bookingId,
    bookingsDb,
    paymentsDb,
    stripeSessionsMock,
    now = new Date("2026-10-25T14:00:00+08:00"),
}) {
    // 1. Authenticate user
    if (!user) {
        return { status: 401, error: "You must be logged in to resume payment." };
    }

    // 2. Validate input
    if (!bookingId || typeof bookingId !== "string" || !bookingId.trim()) {
        return { status: 400, error: "Missing booking ID." };
    }

    // 3. Load booking scoped to user
    const booking = bookingsDb.find((b) => b.id === bookingId && b.user_id === user.id);
    if (!booking) {
        return { status: 404, error: "Booking not found." };
    }

    // 4. Verify status is 'pending'
    const currentStatus = (booking.status || "").toLowerCase();
    if (currentStatus !== "pending") {
        if (currentStatus === "confirmed" || currentStatus === "paid") {
            return { status: 400, error: "This booking has already been confirmed and paid." };
        }
        if (currentStatus === "cancelled") {
            return { status: 400, error: "This booking was cancelled and can no longer be paid." };
        }
        return { status: 400, error: `This booking cannot be resumed (status: ${booking.status}).` };
    }

    // 5. Check if scheduled match start time has passed in Asia/Manila (+08:00)
    const time = booking.start_time.length === 5 ? `${booking.start_time}:00` : booking.start_time.slice(0, 8);
    const startInstant = new Date(`${booking.booking_date}T${time}+08:00`);
    if (startInstant <= now) {
        return { status: 409, error: "The scheduled match time has already passed." };
    }

    // 6. Check for double booking conflicts with confirmed bookings
    const ACTIVE_CONFLICT_STATUSES = ["confirmed", "completed", "checked_in", "in_progress"];
    const hasConflict = bookingsDb.some(
        (b) =>
            b.id !== booking.id &&
            b.court_id === booking.court_id &&
            b.booking_date === booking.booking_date &&
            ACTIVE_CONFLICT_STATUSES.includes(b.status) &&
            b.start_time < booking.end_time &&
            b.end_time > booking.start_time
    );

    if (hasConflict) {
        return { status: 409, error: "This time slot is no longer available. Please choose another slot." };
    }

    // 7. Check existing payment & Stripe session
    const payment = paymentsDb.find((p) => p.booking_id === booking.id);
    if (payment?.stripe_session_id && stripeSessionsMock) {
        const existingSession = stripeSessionsMock.retrieve(payment.stripe_session_id);
        if (existingSession?.status === "open" && existingSession?.url) {
            return { status: 200, url: existingSession.url, reusedSession: true };
        }
    }

    // Create fresh session if none was open
    return {
        status: 200,
        url: `https://checkout.stripe.com/c/pay/cs_new_${booking.id}`,
        reusedSession: false,
    };
}

test("resume payment: rejects unauthenticated caller with 401", () => {
    const res = handleResumePayment({
        user: null,
        bookingId: "b1",
        bookingsDb: [],
        paymentsDb: [],
    });
    assert.equal(res.status, 401);
});

test("resume payment: rejects missing bookingId with 400", () => {
    const res = handleResumePayment({
        user: { id: "user-1" },
        bookingId: "",
        bookingsDb: [],
        paymentsDb: [],
    });
    assert.equal(res.status, 400);
});

test("resume payment: rejects non-existent or unowned booking with 404", () => {
    const bookings = [
        { id: "b1", user_id: "other-user", status: "pending" },
    ];
    const res = handleResumePayment({
        user: { id: "user-1" },
        bookingId: "b1",
        bookingsDb: bookings,
        paymentsDb: [],
    });
    assert.equal(res.status, 404);
});

test("resume payment: rejects confirmed and cancelled bookings with 400", () => {
    const bookings = [
        { id: "b-confirmed", user_id: "u1", status: "confirmed" },
        { id: "b-cancelled", user_id: "u1", status: "cancelled" },
    ];

    const res1 = handleResumePayment({
        user: { id: "u1" },
        bookingId: "b-confirmed",
        bookingsDb: bookings,
        paymentsDb: [],
    });
    assert.equal(res1.status, 400);
    assert.match(res1.error, /already been confirmed/);

    const res2 = handleResumePayment({
        user: { id: "u1" },
        bookingId: "b-cancelled",
        bookingsDb: bookings,
        paymentsDb: [],
    });
    assert.equal(res2.status, 400);
    assert.match(res2.error, /cancelled/);
});

test("resume payment: rejects bookings in the past with 409", () => {
    const bookings = [
        {
            id: "b-past",
            user_id: "u1",
            court_id: "c1",
            booking_date: "2026-10-25",
            start_time: "10:00:00",
            end_time: "11:00:00",
            status: "pending",
        },
    ];

    const res = handleResumePayment({
        user: { id: "u1" },
        bookingId: "b-past",
        bookingsDb: bookings,
        paymentsDb: [],
        now: new Date("2026-10-25T11:30:00+08:00"),
    });
    assert.equal(res.status, 409);
    assert.match(res.error, /already passed/);
});

test("resume payment: rejects booking if slot was claimed by confirmed booking (409)", () => {
    const bookings = [
        {
            id: "b-pending",
            user_id: "u1",
            court_id: "c1",
            booking_date: "2026-10-26",
            start_time: "14:00:00",
            end_time: "16:00:00",
            status: "pending",
        },
        {
            id: "b-conflict",
            user_id: "u2",
            court_id: "c1",
            booking_date: "2026-10-26",
            start_time: "15:00:00",
            end_time: "17:00:00",
            status: "confirmed",
        },
    ];

    const res = handleResumePayment({
        user: { id: "u1" },
        bookingId: "b-pending",
        bookingsDb: bookings,
        paymentsDb: [],
        now: new Date("2026-10-25T10:00:00+08:00"),
    });
    assert.equal(res.status, 409);
    assert.match(res.error, /no longer available/);
});

test("resume payment: reuses open Stripe checkout session if available", () => {
    const bookings = [
        {
            id: "b-valid",
            user_id: "u1",
            court_id: "c1",
            booking_date: "2026-10-26",
            start_time: "14:00:00",
            end_time: "15:00:00",
            status: "pending",
        },
    ];
    const payments = [
        { booking_id: "b-valid", stripe_session_id: "cs_test_open123" },
    ];
    const stripeMock = {
        retrieve: (sessionId) => ({
            id: sessionId,
            status: "open",
            url: "https://checkout.stripe.com/c/pay/cs_test_open123",
        }),
    };

    const res = handleResumePayment({
        user: { id: "u1" },
        bookingId: "b-valid",
        bookingsDb: bookings,
        paymentsDb: payments,
        stripeSessionsMock: stripeMock,
        now: new Date("2026-10-25T10:00:00+08:00"),
    });

    assert.equal(res.status, 200);
    assert.equal(res.reusedSession, true);
    assert.equal(res.url, "https://checkout.stripe.com/c/pay/cs_test_open123");
});
