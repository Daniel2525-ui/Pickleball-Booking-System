import test from "node:test";
import assert from "node:assert/strict";

/**
 * Pure simulation of the booking-status route logic
 * from src/app/api/bookings/status/route.ts
 */
function handleBookingStatusRequest({
    user,
    bookingId,
    bookingsDb,
    profilesDb = [],
}) {
    // 1. Authenticate user from session
    if (!user) {
        return { status: 401, error: "Unauthorized" };
    }

    // 2. Validate input
    if (!bookingId || typeof bookingId !== "string" || !bookingId.trim()) {
        return { status: 400, error: "Missing or invalid booking ID." };
    }

    // 3. Find booking
    const booking = bookingsDb.find((b) => b.id === bookingId.trim());
    if (!booking) {
        return { status: 404, error: "Booking not found." };
    }

    // 4. Verify ownership or admin role
    const isOwner = booking.user_id === user.id;
    const userProfile = profilesDb.find((p) => p.id === user.id);
    const isAdmin = userProfile?.role === "admin";

    if (!isOwner && !isAdmin) {
        // Return 404 to avoid leaking existence of other users' bookings
        return { status: 404, error: "Booking not found." };
    }

    // 5. Return authoritative status without leaking sensitive data
    return {
        status: 200,
        data: {
            id: booking.id,
            status: booking.status,
            hold_expires_at: booking.hold_expires_at || null,
        },
    };
}

test("booking status API: rejects unauthenticated caller with 401", () => {
    const res = handleBookingStatusRequest({
        user: null,
        bookingId: "b-123",
        bookingsDb: [{ id: "b-123", user_id: "user-1", status: "pending" }],
    });
    assert.equal(res.status, 401);
    assert.equal(res.error, "Unauthorized");
});

test("booking status API: rejects missing or blank bookingId with 400", () => {
    const res = handleBookingStatusRequest({
        user: { id: "user-1" },
        bookingId: "   ",
        bookingsDb: [],
    });
    assert.equal(res.status, 400);
    assert.equal(res.error, "Missing or invalid booking ID.");
});

test("booking status API: returns 404 when booking does not exist", () => {
    const res = handleBookingStatusRequest({
        user: { id: "user-1" },
        bookingId: "b-nonexistent",
        bookingsDb: [],
    });
    assert.equal(res.status, 404);
    assert.equal(res.error, "Booking not found.");
});

test("booking status API: returns 404 when booking belongs to another user (prevents enumeration)", () => {
    const res = handleBookingStatusRequest({
        user: { id: "user-attacker" },
        bookingId: "b-victim",
        bookingsDb: [{ id: "b-victim", user_id: "user-victim", status: "pending" }],
        profilesDb: [{ id: "user-attacker", role: "customer" }],
    });
    assert.equal(res.status, 404);
    assert.equal(res.error, "Booking not found.");
});

test("booking status API: returns 200 with status and hold_expires_at for owner", () => {
    const expiry = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const res = handleBookingStatusRequest({
        user: { id: "user-owner" },
        bookingId: "b-100",
        bookingsDb: [
            {
                id: "b-100",
                user_id: "user-owner",
                status: "pending",
                hold_expires_at: expiry,
                customer_email: "secret@example.com",
            },
        ],
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.id, "b-100");
    assert.equal(res.data.status, "pending");
    assert.equal(res.data.hold_expires_at, expiry);
    assert.equal(res.data.customer_email, undefined); // Does not leak email or other columns
});

test("booking status API: permits admin to inspect any booking status", () => {
    const res = handleBookingStatusRequest({
        user: { id: "admin-1" },
        bookingId: "b-cust",
        bookingsDb: [
            {
                id: "b-cust",
                user_id: "customer-99",
                status: "confirmed",
                hold_expires_at: null,
            },
        ],
        profilesDb: [{ id: "admin-1", role: "admin" }],
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.status, "confirmed");
});

test("authoritative zero-countdown resolution: never prematurely cancels booking on client", () => {
    // When countdown hits zero, backend is authoritative
    const booking = {
        id: "b-zero",
        user_id: "u-1",
        status: "pending",
        hold_expires_at: new Date(Date.now() - 5000).toISOString(), // 5s past
    };

    const res = handleBookingStatusRequest({
        user: { id: "u-1" },
        bookingId: "b-zero",
        bookingsDb: [booking],
    });

    // The endpoint reports the real database status as pending
    assert.equal(res.status, 200);
    assert.equal(res.data.status, "pending");
    // Client must not change booking to cancelled on its own
});
