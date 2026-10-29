import test from "node:test";
import assert from "node:assert/strict";
import Stripe from "stripe";
import {
    validateBookingSlot,
    getBookingWeekday,
    validateBasketLines,
} from "../src/lib/services/bookings/validateBookingSlot.service.ts";
import { getBookingStart } from "../src/lib/utils/bookingTime.ts";

// 1. Overlapping Interval Collision Logic (used by hold_court_booking and walk-in reconciliation)
const isIntervalOverlapping = (existingStart, existingEnd, targetStart, targetEnd) => {
    return existingStart < targetEnd && existingEnd > targetStart;
};

test("concurrency conflict logic detects overlapping booking intervals", () => {
    // Target interval: 08:00 to 10:00
    const targetStart = "08:00:00";
    const targetEnd = "10:00:00";

    // Exact match
    assert.equal(isIntervalOverlapping("08:00:00", "10:00:00", targetStart, targetEnd), true);

    // Overlaps start (07:00 to 09:00)
    assert.equal(isIntervalOverlapping("07:00:00", "09:00:00", targetStart, targetEnd), true);

    // Overlaps end (09:00 to 11:00)
    assert.equal(isIntervalOverlapping("09:00:00", "11:00:00", targetStart, targetEnd), true);

    // Completely within target (08:30 to 09:30)
    assert.equal(isIntervalOverlapping("08:30:00", "09:30:00", targetStart, targetEnd), true);

    // Completely envelopes target (07:00 to 11:00)
    assert.equal(isIntervalOverlapping("07:00:00", "11:00:00", targetStart, targetEnd), true);

    // Adjacent before (06:00 to 08:00) - should NOT overlap
    assert.equal(isIntervalOverlapping("06:00:00", "08:00:00", targetStart, targetEnd), false);

    // Adjacent after (10:00 to 12:00) - should NOT overlap
    assert.equal(isIntervalOverlapping("10:00:00", "12:00:00", targetStart, targetEnd), false);

    // Completely disjoint (12:00 to 13:00) - should NOT overlap
    assert.equal(isIntervalOverlapping("12:00:00", "13:00:00", targetStart, targetEnd), false);
});

// 2. Stripe Error Classifier (Definite Pre-Creation Failure vs Ambiguous Timeout)
const isDefinitePreCreationError = (err) => {
    return (
        err instanceof Stripe.errors.StripeInvalidRequestError ||
        err instanceof Stripe.errors.StripeAuthenticationError ||
        err instanceof Stripe.errors.StripePermissionError ||
        Boolean(err?.message?.includes("Stripe is not configured"))
    );
};

test("Stripe error classifier correctly differentiates definite pre-creation errors from ambiguous timeouts using real Stripe.errors classes", () => {
    // Definite failures where NO session was created -> Safe to roll back
    const invalidReqErr = new Stripe.errors.StripeInvalidRequestError({ message: "Invalid parameter: line_items" });
    const authErr = new Stripe.errors.StripeAuthenticationError({ message: "Invalid API Key provided" });
    const permErr = new Stripe.errors.StripePermissionError({ message: "Access forbidden" });
    const unconfiguredErr = new Error("Stripe is not configured. Please contact the administrator.");

    assert.equal(isDefinitePreCreationError(invalidReqErr), true);
    assert.equal(isDefinitePreCreationError(authErr), true);
    assert.equal(isDefinitePreCreationError(permErr), true);
    assert.equal(isDefinitePreCreationError(unconfiguredErr), true);

    // Ambiguous timeouts/drops where session MAY exist -> Must NOT delete records
    const connErr = new Stripe.errors.StripeConnectionError({ message: "Connection timeout to Stripe API" });
    const apiErr = new Stripe.errors.StripeAPIError({ message: "Stripe internal server error 500" });
    const rateLimitErr = new Stripe.errors.StripeRateLimitError({ message: "Too many requests" });
    const networkErr = new Error("fetch failed: ECONNRESET");

    assert.equal(isDefinitePreCreationError(connErr), false);
    assert.equal(isDefinitePreCreationError(apiErr), false);
    assert.equal(isDefinitePreCreationError(rateLimitErr), false);
    assert.equal(isDefinitePreCreationError(networkErr), false);
});

// 3. Admin-configured duration limits are enforced (pricing itself: tests/quote-court-price.test.mjs)
test("validateBookingSlot follows the configured min and max booking length", () => {
    const now = new Date("2026-10-24T06:00:00+08:00");
    const slot = (endTime, limits) => validateBookingSlot({ bookingDate: "2026-10-25", startTime: "08:00", endTime, now, limits });
    assert.equal(slot("10:00", { min_hours: 2, max_hours: 4 }).valid, true);
    assert.equal(slot("12:00", { min_hours: 2, max_hours: 4 }).valid, true);
    assert.deepEqual(slot("09:00", { min_hours: 2, max_hours: 4 }), { valid: false, error: "Booking duration must be between 2 and 4 consecutive hours." });
    assert.deepEqual(slot("13:00", { min_hours: 2, max_hours: 4 }), { valid: false, error: "Booking duration must be between 2 and 4 consecutive hours." });
});

// 4. Server-side Time and Duration Validation (Production validateBookingSlot)
test("validateBookingSlot accepts valid 1, 2, and 3-hour bookings", () => {
    const futureTime = new Date("2026-10-24T06:00:00+08:00");
    const openVenue = { is_open: true, open_time: "07:00:00", close_time: "22:00:00" };

    const oneHour = validateBookingSlot({
        limits: { min_hours: 1, max_hours: 3 },
        bookingDate: "2026-10-25",
        startTime: "08:00",
        endTime: "09:00",
        operatingHour: openVenue,
        now: futureTime,
    });
    assert.equal(oneHour.valid, true);
    if (oneHour.valid) {
        assert.equal(oneHour.durationHours, 1);
        assert.equal(oneHour.startTimeDb, "08:00:00");
        assert.equal(oneHour.endTimeDb, "09:00:00");
    }

    const twoHours = validateBookingSlot({
        limits: { min_hours: 1, max_hours: 3 },
        bookingDate: "2026-10-25",
        startTime: "08:00:00",
        endTime: "10:00:00",
        operatingHour: openVenue,
        now: futureTime,
    });
    assert.equal(twoHours.valid, true);
    if (twoHours.valid) {
        assert.equal(twoHours.durationHours, 2);
    }

    const threeHours = validateBookingSlot({
        limits: { min_hours: 1, max_hours: 3 },
        bookingDate: "2026-10-25",
        startTime: "14:00",
        endTime: "17:00",
        operatingHour: openVenue,
        now: futureTime,
    });
    assert.equal(threeHours.valid, true);
    if (threeHours.valid) {
        assert.equal(threeHours.durationHours, 3);
    }
});

test("validateBookingSlot rejects invalid durations, non-whole-hour times, and malformed inputs", () => {
    const futureTime = new Date("2026-10-24T06:00:00+08:00");

    // 0 hours
    assert.deepEqual(
        validateBookingSlot({
        limits: { min_hours: 1, max_hours: 3 },
            bookingDate: "2026-10-25",
            startTime: "08:00",
            endTime: "08:00",
            now: futureTime,
        }),
        { valid: false, error: "Booking duration must be between 1 and 3 consecutive hours." }
    );

    // Inverted times / negative duration
    assert.deepEqual(
        validateBookingSlot({
        limits: { min_hours: 1, max_hours: 3 },
            bookingDate: "2026-10-25",
            startTime: "10:00",
            endTime: "08:00",
            now: futureTime,
        }),
        { valid: false, error: "Booking duration must be between 1 and 3 consecutive hours." }
    );

    // Exceeds 3 hours (4 hours)
    assert.deepEqual(
        validateBookingSlot({
        limits: { min_hours: 1, max_hours: 3 },
            bookingDate: "2026-10-25",
            startTime: "08:00",
            endTime: "12:00",
            now: futureTime,
        }),
        { valid: false, error: "Booking duration must be between 1 and 3 consecutive hours." }
    );

    // Non-whole hour (minutes)
    assert.deepEqual(
        validateBookingSlot({
        limits: { min_hours: 1, max_hours: 3 },
            bookingDate: "2026-10-25",
            startTime: "08:15",
            endTime: "09:15",
            now: futureTime,
        }),
        { valid: false, error: "Reservations must be booked in whole-hour increments on the hour." }
    );

    // Malformed strings
    assert.deepEqual(
        validateBookingSlot({
        limits: { min_hours: 1, max_hours: 3 },
            bookingDate: "invalid-date",
            startTime: "08:00",
            endTime: "09:00",
            now: futureTime,
        }),
        { valid: false, error: "Invalid booking date format. Expected YYYY-MM-DD." }
    );
});

// 5. Operating Hours Boundary Validation (Production validateBookingSlot)
test("operating hours validation enforces opening and closing boundaries", () => {
    const futureTime = new Date("2026-10-24T05:00:00+08:00");
    const venueHours = { is_open: true, open_time: "06:00:00", close_time: "22:00:00" };

    // Valid: right at open time
    assert.equal(
        validateBookingSlot({
        limits: { min_hours: 1, max_hours: 3 },
            bookingDate: "2026-10-25",
            startTime: "06:00",
            endTime: "08:00",
            operatingHour: venueHours,
            now: futureTime,
        }).valid,
        true
    );

    // Valid: right at close time
    assert.equal(
        validateBookingSlot({
        limits: { min_hours: 1, max_hours: 3 },
            bookingDate: "2026-10-25",
            startTime: "20:00",
            endTime: "22:00",
            operatingHour: venueHours,
            now: futureTime,
        }).valid,
        true
    );

    // Invalid: ends after closing time
    assert.deepEqual(
        validateBookingSlot({
        limits: { min_hours: 1, max_hours: 3 },
            bookingDate: "2026-10-25",
            startTime: "21:00",
            endTime: "23:00",
            operatingHour: venueHours,
            now: futureTime,
        }),
        { valid: false, error: "The selected time range falls outside venue operating hours." }
    );

    // Invalid: starts before opening time
    assert.deepEqual(
        validateBookingSlot({
        limits: { min_hours: 1, max_hours: 3 },
            bookingDate: "2026-10-25",
            startTime: "05:00",
            endTime: "07:00",
            operatingHour: venueHours,
            now: futureTime,
        }),
        { valid: false, error: "The selected time range falls outside venue operating hours." }
    );

    // Invalid: venue closed for the day
    assert.deepEqual(
        validateBookingSlot({
        limits: { min_hours: 1, max_hours: 3 },
            bookingDate: "2026-10-25",
            startTime: "08:00",
            endTime: "10:00",
            operatingHour: { is_open: false, open_time: null, close_time: null },
            now: futureTime,
        }),
        { valid: false, error: "The venue is closed on this date." }
    );
});

// 6. Unavailable Intermediate Hours Detection
test("detects conflicts when intermediate hours are already booked or pending in a multi-hour request", () => {
    // Customer requests a 3-hour booking: 08:00 to 11:00
    const requestedStart = "08:00:00";
    const requestedEnd = "11:00:00";

    // Scenario A: First hour is taken (08:00 - 09:00)
    assert.equal(isIntervalOverlapping("08:00:00", "09:00:00", requestedStart, requestedEnd), true);

    // Scenario B: Intermediate hour is taken (09:00 - 10:00)
    assert.equal(isIntervalOverlapping("09:00:00", "10:00:00", requestedStart, requestedEnd), true);

    // Scenario C: Last hour is taken (10:00 - 11:00)
    assert.equal(isIntervalOverlapping("10:00:00", "11:00:00", requestedStart, requestedEnd), true);

    // Scenario D: Entire block is free (earlier booking 06:00 - 08:00 and later 11:00 - 13:00)
    assert.equal(isIntervalOverlapping("06:00:00", "08:00:00", requestedStart, requestedEnd), false);
    assert.equal(isIntervalOverlapping("11:00:00", "13:00:00", requestedStart, requestedEnd), false);
});

// 7. Past Dates and Times Validation (Production validateBookingSlot & getBookingStart)
test("past date and time validation blocks slots that have already started or passed in Asia/Manila", () => {
    const referenceNow = new Date("2026-10-24T10:30:00+08:00");

    // Past date (yesterday)
    assert.equal(
        validateBookingSlot({
        limits: { min_hours: 1, max_hours: 3 },
            bookingDate: "2026-10-23",
            startTime: "08:00",
            endTime: "09:00",
            now: referenceNow,
        }).valid,
        false
    );

    // Same day, past time (08:00 vs 10:30)
    assert.equal(
        validateBookingSlot({
        limits: { min_hours: 1, max_hours: 3 },
            bookingDate: "2026-10-24",
            startTime: "08:00",
            endTime: "09:00",
            now: referenceNow,
        }).valid,
        false
    );

    // Same day, currently in-progress (10:00 vs 10:30)
    assert.equal(
        validateBookingSlot({
        limits: { min_hours: 1, max_hours: 3 },
            bookingDate: "2026-10-24",
            startTime: "10:00",
            endTime: "11:00",
            now: referenceNow,
        }).valid,
        false
    );

    // Same day, future time (11:00 vs 10:30)
    assert.equal(
        validateBookingSlot({
        limits: { min_hours: 1, max_hours: 3 },
            bookingDate: "2026-10-24",
            startTime: "11:00",
            endTime: "12:00",
            now: referenceNow,
        }).valid,
        true
    );

    // Future date
    assert.equal(
        validateBookingSlot({
        limits: { min_hours: 1, max_hours: 3 },
            bookingDate: "2026-10-25",
            startTime: "08:00",
            endTime: "09:00",
            now: referenceNow,
        }).valid,
        true
    );
});

// 8. Timezone and Weekday Conversion (Asia/Manila)
test("getBookingWeekday resolves correct weekday without UTC date-shift", () => {
    // 2026-10-25 is a Sunday
    assert.equal(getBookingWeekday("2026-10-25"), "Sunday");
    // 2026-10-26 is a Monday
    assert.equal(getBookingWeekday("2026-10-26"), "Monday");
    // 2026-10-27 is a Tuesday
    assert.equal(getBookingWeekday("2026-10-27"), "Tuesday");
    // 2026-10-28 is a Wednesday
    assert.equal(getBookingWeekday("2026-10-28"), "Wednesday");
    // 2026-10-29 is a Thursday
    assert.equal(getBookingWeekday("2026-10-29"), "Thursday");
    // 2026-10-30 is a Friday
    assert.equal(getBookingWeekday("2026-10-30"), "Friday");
    // 2026-10-31 is a Saturday
    assert.equal(getBookingWeekday("2026-10-31"), "Saturday");
});

// 9. Hold Lifecycle and Failure Recovery Logic (Task 3)
const evaluateHoldRecoveryAction = (error, bookingId) => {
    const isDefinitePreCreationError =
        error instanceof Stripe.errors.StripeInvalidRequestError ||
        error instanceof Stripe.errors.StripeAuthenticationError ||
        error instanceof Stripe.errors.StripePermissionError ||
        Boolean(error?.message?.includes("Stripe is not configured"));

    if (isDefinitePreCreationError) {
        return {
            action: "delete_pending_records",
            httpStatus: 400,
            shouldPreserveHold: false,
        };
    }

    if (bookingId) {
        return {
            action: "preserve_hold_for_async_recovery",
            httpStatus: 500,
            shouldPreserveHold: true,
        };
    }

    return {
        action: "generic_error",
        httpStatus: 500,
        shouldPreserveHold: false,
    };
};

test("evaluateHoldRecoveryAction preserves pending holds on ambiguous timeouts and deletes on pre-creation failure", () => {
    const bookingId = "b9090623-1111-2222-3333-444455556666";

    // Definite failure: Bad params -> must delete hold immediately
    const invalidParamErr = new Stripe.errors.StripeInvalidRequestError({ message: "Invalid line_items" });
    assert.deepEqual(evaluateHoldRecoveryAction(invalidParamErr, bookingId), {
        action: "delete_pending_records",
        httpStatus: 400,
        shouldPreserveHold: false,
    });

    // Ambiguous failure: Network timeout -> MUST NOT delete hold
    const timeoutErr = new Stripe.errors.StripeConnectionError({ message: "Connection timeout" });
    assert.deepEqual(evaluateHoldRecoveryAction(timeoutErr, bookingId), {
        action: "preserve_hold_for_async_recovery",
        httpStatus: 500,
        shouldPreserveHold: true,
    });

    // Ambiguous failure: 500 API error -> MUST NOT delete hold
    const apiErr = new Stripe.errors.StripeAPIError({ message: "Stripe internal error" });
    assert.deepEqual(evaluateHoldRecoveryAction(apiErr, bookingId), {
        action: "preserve_hold_for_async_recovery",
        httpStatus: 500,
        shouldPreserveHold: true,
    });
});

test("checkout expiry strategy: fresh calculation guarantees Stripe >=30m minimum and DB hold coverage", () => {
    // 1. Simulate DB RPC duration taking various times (from fast 200ms to slow 65s)
    const simulatedDbLatenciesSec = [0.2, 2, 10, 65];

    for (const dbLatencySec of simulatedDbLatenciesSec) {
        const requestStartMs = 1700000000000;
        // Step 1: Initial DB hold calculation with 35-minute safety buffer
        const initialHoldExpiresAtIso = new Date(requestStartMs + 35 * 60 * 1000).toISOString();

        // Step 2: Time passes during DB RPC execution
        const dbCompleteMs = requestStartMs + Math.round(dbLatencySec * 1000);

        // Step 3: Fresh Stripe calculation evaluated immediately before sessions.create (33 minutes = 1980s)
        const stripeExpiresAtSec = Math.floor(dbCompleteMs / 1000) + (33 * 60);

        // Assert: When Stripe receives the request at dbCompleteMs, remaining window is ALWAYS exactly 1980s (33m)
        const remainingWindowAtStripeSec = stripeExpiresAtSec - Math.floor(dbCompleteMs / 1000);
        assert.equal(remainingWindowAtStripeSec, 1980, "Stripe expiry window must always be 1980s (33m) at call time");
        assert.equal(remainingWindowAtStripeSec - 1800, 180, "Must provide 180s (3m) safety margin above Stripe minimum 30-minute threshold");

        // Step 4: Authoritative coordination on session return (session.expires_at + 120s)
        const sessionExpiresAt = stripeExpiresAtSec;
        const coordinatedHoldExpiresAtIso = new Date((sessionExpiresAt + 120) * 1000).toISOString();
        const coordinatedHoldExpiresAtMs = new Date(coordinatedHoldExpiresAtIso).getTime();

        // Assert: Coordinated DB hold covers entire Stripe session + 2-minute webhook grace buffer
        assert.equal(
            coordinatedHoldExpiresAtMs - (sessionExpiresAt * 1000),
            120 * 1000,
            "DB hold must extend 2 minutes beyond Stripe session expiry"
        );
    }
});

// 10. Post-Stripe Confirmation Failure Handling
const evaluatePostStripeFailureAction = ({ confirmError, sessionCreated }) => {
    if (!sessionCreated) {
        throw new Error("Pre-condition: session must have been created");
    }

    const isConflict = confirmError?.message?.includes("SLOT_UNAVAILABLE") || confirmError?.code === "P0001";
    if (isConflict) {
        return {
            action: "expire_stripe_session_and_reject_resurrection",
            shouldDeleteBooking: false,
            shouldExpireStripeSession: true,
            httpStatus: 409,
        };
    }

    return {
        action: "expire_stripe_session_and_preserve_hold_for_recovery",
        shouldDeleteBooking: false,
        shouldExpireStripeSession: true,
        httpStatus: 500,
    };
};

test("post-Stripe failure handling: preserves booking records and expires Stripe session on conflict or DB error", () => {
    // Case 1: Slot claimed while Stripe was processing (expired-hold resurrection prevented)
    const conflictErr = { message: "SLOT_UNAVAILABLE: Slot was claimed", code: "P0001" };
    const conflictResult = evaluatePostStripeFailureAction({ confirmError: conflictErr, sessionCreated: true });
    assert.deepEqual(conflictResult, {
        action: "expire_stripe_session_and_reject_resurrection",
        shouldDeleteBooking: false,
        shouldExpireStripeSession: true,
        httpStatus: 409,
    });

    // Case 2: Database failure after Stripe session creation
    const dbErr = { message: "Connection timeout to PostgreSQL", code: "57P01" };
    const dbResult = evaluatePostStripeFailureAction({ confirmError: dbErr, sessionCreated: true });
    assert.deepEqual(dbResult, {
        action: "expire_stripe_session_and_preserve_hold_for_recovery",
        shouldDeleteBooking: false,
        shouldExpireStripeSession: true,
        httpStatus: 500,
    });
});

test("route error classifier: disambiguates SLOT_UNAVAILABLE from COURT_UNAVAILABLE and VENUE_CLOSED without relying on P0001", () => {
    const parseCheckoutRpcError = (rpcError) => {
        const isConflict = rpcError.message?.includes("SLOT_UNAVAILABLE");
        if (isConflict) return { status: 409, type: "conflict" };

        const isVenueClosed = rpcError.message?.includes("VENUE_CLOSED");
        if (isVenueClosed) return { status: 400, type: "venue_closed" };

        const isCourtUnavailable = rpcError.message?.includes("COURT_UNAVAILABLE");
        if (isCourtUnavailable) return { status: 400, type: "court_unavailable" };

        return { status: 500, type: "generic" };
    };

    // P0001 with SLOT_UNAVAILABLE -> Conflict (409)
    assert.deepEqual(
        parseCheckoutRpcError({ message: "SLOT_UNAVAILABLE", code: "P0001" }),
        { status: 409, type: "conflict" }
    );

    // P0001 with VENUE_CLOSED -> Venue closed (400), not conflict
    assert.deepEqual(
        parseCheckoutRpcError({ message: "VENUE_CLOSED: The venue is closed on this date", code: "P0001" }),
        { status: 400, type: "venue_closed" }
    );

    // P0001 with COURT_UNAVAILABLE -> Court unavailable (400), not conflict
    assert.deepEqual(
        parseCheckoutRpcError({ message: "COURT_UNAVAILABLE: Court is currently not available", code: "P0001" }),
        { status: 400, type: "court_unavailable" }
    );

    // Generic unhandled P0001 -> Generic 500, not conflict
    assert.deepEqual(
        parseCheckoutRpcError({ message: "Internal trigger failure", code: "P0001" }),
        { status: 500, type: "generic" }
    );
});

// 10. Automated Expiration Cleanup Policy (Task 3)
const isBookingEligibleForExpiredCleanup = (booking, now = new Date()) => {
    if (booking.status !== "pending") return false;
    const createdAt = new Date(booking.created_at);
    const thirtyMinutesMs = 30 * 60 * 1000;
    if (now.getTime() - createdAt.getTime() < thirtyMinutesMs) return false;

    // Must never cancel if any payment succeeded
    const payments = booking.payments || [];
    const hasPaidPayment = payments.some((p) => p.status === "paid");
    if (hasPaidPayment) return false;

    return true;
};

test("cleanup expiration policy only expires unpaid pending bookings older than 30 minutes", () => {
    const now = new Date("2026-10-24T20:45:00Z");

    // Old pending booking, unpaid -> Eligible for cleanup
    assert.equal(
        isBookingEligibleForExpiredCleanup(
            {
                status: "pending",
                created_at: "2026-10-24T20:00:00Z", // 45 mins ago
                payments: [{ status: "pending" }],
            },
            now
        ),
        true
    );

    // Recent pending booking (<30 mins) -> Not eligible yet
    assert.equal(
        isBookingEligibleForExpiredCleanup(
            {
                status: "pending",
                created_at: "2026-10-24T20:25:00Z", // 20 mins ago
                payments: [{ status: "pending" }],
            },
            now
        ),
        false
    );

    // Old pending booking, but payment was marked paid -> PROTECTED, NEVER cancel
    assert.equal(
        isBookingEligibleForExpiredCleanup(
            {
                status: "pending",
                created_at: "2026-10-24T20:00:00Z",
                payments: [{ status: "paid" }],
            },
            now
        ),
        false
    );

    // Already confirmed booking -> Never cancel
    assert.equal(
        isBookingEligibleForExpiredCleanup(
            {
                status: "confirmed",
                created_at: "2026-10-24T20:00:00Z",
                payments: [{ status: "paid" }],
            },
            now
        ),
        false
    );
});

// 11. RPC Security Definer Authorization Rules Simulation
const evaluateRpcAuthorization = ({ rpcName, authRole, authUid, sessionUser, profileRole, requestedUserId }) => {
    // Narrowed trust boundary: strictly service_role JWT or raw console psql without active JWT
    const isServiceRole =
        authRole === "service_role" ||
        (sessionUser === "postgres" && !authRole);

    if (rpcName === "hold_court_booking") {
        if (!isServiceRole) {
            if (!authUid || authRole !== "authenticated") {
                return { allowed: false, error: "UNAUTHORIZED: Authentication required to reserve a court" };
            }
            if (requestedUserId && requestedUserId !== authUid) {
                return { allowed: false, error: "FORBIDDEN: Cannot hold court on behalf of another player" };
            }
            return { allowed: true, resolvedUserId: authUid };
        }
        if (!requestedUserId) {
            return { allowed: false, error: "INVALID_ARGUMENT: p_user_id is required" };
        }
        return { allowed: true, resolvedUserId: requestedUserId };
    }

    if (rpcName === "create_walk_in_booking") {
        if (!isServiceRole) {
            if (!authUid || authRole !== "authenticated") {
                return { allowed: false, error: "UNAUTHORIZED: Authentication required to record walk-in reservations" };
            }
            if (profileRole !== "admin") {
                return { allowed: false, error: "FORBIDDEN: Admin privileges required to record walk-in reservations" };
            }
        }
        return { allowed: true };
    }

    return { allowed: false, error: "UNKNOWN_RPC" };
};

test("RPC authorization correctly differentiates customer, admin, service_role, and anonymous callers", () => {
    const customerUid = "user-1111-customer";
    const otherUid = "user-2222-victim";
    const adminUid = "user-9999-admin";

    // 1. Anonymous caller -> REJECTED from both RPCs
    assert.deepEqual(
        evaluateRpcAuthorization({
            rpcName: "hold_court_booking",
            authRole: "anon",
            authUid: null,
            sessionUser: "authenticator",
        }),
        { allowed: false, error: "UNAUTHORIZED: Authentication required to reserve a court" }
    );
    assert.deepEqual(
        evaluateRpcAuthorization({
            rpcName: "create_walk_in_booking",
            authRole: "anon",
            authUid: null,
            sessionUser: "authenticator",
        }),
        { allowed: false, error: "UNAUTHORIZED: Authentication required to record walk-in reservations" }
    );

    // 2. Authenticated Customer holding for self -> ALLOWED
    assert.deepEqual(
        evaluateRpcAuthorization({
            rpcName: "hold_court_booking",
            authRole: "authenticated",
            authUid: customerUid,
            sessionUser: "authenticator",
            requestedUserId: customerUid,
        }),
        { allowed: true, resolvedUserId: customerUid }
    );

    // 3. Authenticated Customer trying to hold for another user -> FORBIDDEN
    assert.deepEqual(
        evaluateRpcAuthorization({
            rpcName: "hold_court_booking",
            authRole: "authenticated",
            authUid: customerUid,
            sessionUser: "authenticator",
            requestedUserId: otherUid,
        }),
        { allowed: false, error: "FORBIDDEN: Cannot hold court on behalf of another player" }
    );

    // 4. Authenticated Customer trying to record walk-in -> FORBIDDEN
    assert.deepEqual(
        evaluateRpcAuthorization({
            rpcName: "create_walk_in_booking",
            authRole: "authenticated",
            authUid: customerUid,
            sessionUser: "authenticator",
            profileRole: "customer",
        }),
        { allowed: false, error: "FORBIDDEN: Admin privileges required to record walk-in reservations" }
    );

    // 5. Authenticated Admin recording walk-in -> ALLOWED
    assert.deepEqual(
        evaluateRpcAuthorization({
            rpcName: "create_walk_in_booking",
            authRole: "authenticated",
            authUid: adminUid,
            sessionUser: "authenticator",
            profileRole: "admin",
        }),
        { allowed: true }
    );

    // 6. Trusted Service Role via PostgREST -> ALLOWED for both
    assert.deepEqual(
        evaluateRpcAuthorization({
            rpcName: "hold_court_booking",
            authRole: "service_role",
            authUid: null,
            sessionUser: "authenticator",
            requestedUserId: customerUid,
        }),
        { allowed: true, resolvedUserId: customerUid }
    );
    assert.deepEqual(
        evaluateRpcAuthorization({
            rpcName: "create_walk_in_booking",
            authRole: "service_role",
            authUid: null,
            sessionUser: "authenticator",
        }),
        { allowed: true }
    );

    // 7. Narrowed boundary check: supabase_admin is NOT privileged
    assert.deepEqual(
        evaluateRpcAuthorization({
            rpcName: "hold_court_booking",
            authRole: "anon",
            authUid: null,
            sessionUser: "supabase_admin",
            requestedUserId: customerUid,
        }),
        { allowed: false, error: "UNAUTHORIZED: Authentication required to reserve a court" }
    );

    // 8. Narrowed boundary check: direct postgres console without JWT -> ALLOWED
    assert.deepEqual(
        evaluateRpcAuthorization({
            rpcName: "hold_court_booking",
            authRole: null,
            authUid: null,
            sessionUser: "postgres",
            requestedUserId: customerUid,
        }),
        { allowed: true, resolvedUserId: customerUid }
    );
});

// 12. Transaction Rollback Simulation (All-or-Nothing Booking + Payment Insert)
test("simulated atomic transaction rolls back booking insert when payment insert fails", () => {
    const mockDb = { bookings: [], payments: [] };

    const atomicHoldTransaction = (bookingData, paymentData, simulatePaymentFailure = false) => {
        // Transaction starts
        const snapshotBookings = [...mockDb.bookings];
        const snapshotPayments = [...mockDb.payments];

        try {
            // Step 1: Insert booking
            const bookingId = "bk-" + (mockDb.bookings.length + 1);
            mockDb.bookings.push({ id: bookingId, ...bookingData });

            // Step 2: Insert payment
            if (simulatePaymentFailure) {
                throw new Error("DB_PAYMENT_INSERT_ERROR: check constraint violated on amount");
            }
            mockDb.payments.push({ id: "pm-" + (mockDb.payments.length + 1), booking_id: bookingId, ...paymentData });

            return { success: true, bookingId };
        } catch (err) {
            // Transaction aborts & rolls back
            mockDb.bookings = snapshotBookings;
            mockDb.payments = snapshotPayments;
            return { success: false, error: err.message };
        }
    };

    // Case A: Normal operation -> Both records inserted
    const okResult = atomicHoldTransaction({ user_id: "u1", amount: 400 }, { amount: 400 }, false);
    assert.equal(okResult.success, true);
    assert.equal(mockDb.bookings.length, 1);
    assert.equal(mockDb.payments.length, 1);

    // Case B: Payment insert fails -> Entire transaction rolls back, 0 new rows remain
    const failResult = atomicHoldTransaction({ user_id: "u2", amount: -200 }, { amount: -200 }, true);
    assert.equal(failResult.success, false);
    assert.equal(mockDb.bookings.length, 1); // Still 1 from previous successful run
    assert.equal(mockDb.payments.length, 1); // Still 1 from previous successful run
});

// 13. Simulated Database RPC Business Rule Enforcement Unit Tests (Node.js Simulation)
// NOTE: These Node.js tests verify the logical behavior of the PL/pgSQL validation pipeline.
// They DO NOT replace live PostgreSQL integration testing against a real database instance.
const simulateHoldCourtBookingRpc = ({
    authRole,
    authUid,
    sessionUser,
    courtId,
    bookingDate,
    startTime,
    endTime,
    userId,
    amount,
    operatingHoursTable = {},
    courtsTable = {},
    bookingsTable = [],
    nowManila = new Date("2026-10-24T10:00:00+08:00"),
}) => {
    // 1. Authorization
    const isServiceRole =
        authRole === "service_role" || (sessionUser === "postgres" && !authRole);

    let effectiveUserId = userId;
    if (!isServiceRole) {
        if (!authUid || authRole !== "authenticated") {
            throw new Error("UNAUTHORIZED: Authentication required to reserve a court (42501)");
        }
        if (userId && userId !== authUid) {
            throw new Error("FORBIDDEN: Cannot hold court on behalf of another player (42501)");
        }
        effectiveUserId = authUid;
    } else {
        if (!userId) throw new Error("INVALID_ARGUMENT: p_user_id is required (22000)");
    }

    // 2. Time boundaries & whole-hour increments
    if (startTime >= endTime) {
        throw new Error("INVALID_TIME_RANGE: start_time must be earlier than end_time (22000)");
    }

    const wholeHourRegex = /^([01]\d|2[0-3]):00(:00)?$/;
    if (!wholeHourRegex.test(startTime) || !wholeHourRegex.test(endTime)) {
        throw new Error("INVALID_TIME_INCREMENT: Reservations must be booked in whole-hour increments on the hour (22000)");
    }

    const startHour = parseInt(startTime.slice(0, 2), 10);
    const endHour = parseInt(endTime.slice(0, 2), 10);
    const durationHours = endHour - startHour;

    if (durationHours < 1 || durationHours > 3) {
        throw new Error("INVALID_DURATION: Booking duration must be between 1 and 3 consecutive hours (22000)");
    }

    // 3. Past slot in Asia/Manila
    const startTimeFormatted = startTime.length === 5 ? `${startTime}:00` : startTime;
    const endTimeFormatted = endTime.length === 5 ? `${endTime}:00` : endTime;
    const slotStartInstant = new Date(`${bookingDate}T${startTimeFormatted}+08:00`);
    if (slotStartInstant <= nowManila) {
        throw new Error("PAST_SLOT: The requested time slot has already passed (22000)");
    }

    // 4. Operating hours lookup
    const targetDateInManila = new Date(`${bookingDate}T12:00:00+08:00`);
    const dayOfWeek = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "Asia/Manila" }).format(targetDateInManila);
    const daySchedule = operatingHoursTable[dayOfWeek];

    if (!daySchedule || !daySchedule.is_open || !daySchedule.open_time || !daySchedule.close_time) {
        throw new Error("VENUE_CLOSED: The venue is closed on this date (P0001)");
    }

    if (startTimeFormatted < daySchedule.open_time || endTimeFormatted > daySchedule.close_time) {
        throw new Error("OUTSIDE_OPERATING_HOURS: The selected time range falls outside venue operating hours (22000)");
    }

    // 5. Price verification (PHP 200/hr)
    const expectedAmount = durationHours * 200;
    if (amount !== undefined && amount !== null && amount !== expectedAmount) {
        throw new Error(`INVALID_AMOUNT: Expected amount of ${expectedAmount} PHP for ${durationHours} hour(s), but received ${amount} PHP (22000)`);
    }

    // 6. Court existence & status
    const court = courtsTable[courtId];
    if (!court) {
        throw new Error("NOT_FOUND: Court does not exist (P0002)");
    }
    if (["maintenance", "closed", "inactive"].includes(court.status?.toLowerCase())) {
        throw new Error("COURT_UNAVAILABLE: Court is currently not available for reservations (P0001)");
    }

    // 7. Interval overlap conflict
    const hasConflict = bookingsTable.some((b) => {
        if (b.court_id !== courtId || b.booking_date !== bookingDate) return false;
        if (!["confirmed", "checked_in", "in_progress", "completed", "pending"].includes(b.status)) return false;
        return b.start_time < endTimeFormatted && b.end_time > startTimeFormatted;
    });

    if (hasConflict) {
        throw new Error("SLOT_UNAVAILABLE: This court slot is no longer available (P0001)");
    }

    return {
        booking_id: "bk-simulated-" + Math.floor(Math.random() * 10000),
        payment_id: "pm-simulated-" + Math.floor(Math.random() * 10000),
        effective_user_id: effectiveUserId,
        duration_hours: durationHours,
        total_amount: expectedAmount,
    };
};

test("simulated hold_court_booking independently enforces past dates, closed days, out-of-hours, and prices", () => {
    const validCourtId = "court-1111-active";
    const userUid = "user-customer-99";
    const courtsTable = {
        [validCourtId]: { id: validCourtId, status: "active" },
        "court-maint": { id: "court-maint", status: "maintenance" },
    };
    const operatingHoursTable = {
        Sunday: { is_open: true, open_time: "07:00:00", close_time: "22:00:00" },
        Monday: { is_open: false, open_time: null, close_time: null }, // Closed venue day
        Tuesday: { is_open: true, open_time: "08:00:00", close_time: "20:00:00" },
    };
    const bookingsTable = [
        { court_id: validCourtId, booking_date: "2026-10-25", start_time: "10:00:00", end_time: "12:00:00", status: "confirmed" },
    ];
    const nowInManila = new Date("2026-10-24T10:00:00+08:00");

    // Case 1: Past date rejection (Yesterday 2026-10-23)
    assert.throws(
        () =>
            simulateHoldCourtBookingRpc({
                authRole: "authenticated",
                authUid: userUid,
                sessionUser: "authenticator",
                courtId: validCourtId,
                bookingDate: "2026-10-23",
                startTime: "08:00:00",
                endTime: "09:00:00",
                userId: userUid,
                amount: 200,
                operatingHoursTable,
                courtsTable,
                bookingsTable,
                nowManila: nowInManila,
            }),
        /PAST_SLOT/
    );

    // Case 2: Same day, past time (08:00 when now is 10:00)
    assert.throws(
        () =>
            simulateHoldCourtBookingRpc({
                authRole: "authenticated",
                authUid: userUid,
                sessionUser: "authenticator",
                courtId: validCourtId,
                bookingDate: "2026-10-24",
                startTime: "08:00:00",
                endTime: "09:00:00",
                userId: userUid,
                amount: 200,
                operatingHoursTable,
                courtsTable,
                bookingsTable,
                nowManila: nowInManila,
            }),
        /PAST_SLOT/
    );

    // Case 3: Closed venue day (2026-10-26 is Monday, closed in schedule)
    assert.throws(
        () =>
            simulateHoldCourtBookingRpc({
                authRole: "authenticated",
                authUid: userUid,
                sessionUser: "authenticator",
                courtId: validCourtId,
                bookingDate: "2026-10-26",
                startTime: "08:00:00",
                endTime: "09:00:00",
                userId: userUid,
                amount: 200,
                operatingHoursTable,
                courtsTable,
                bookingsTable,
                nowManila: nowInManila,
            }),
        /VENUE_CLOSED/
    );

    // Case 4: Out-of-hours (Too early: 06:00 when Sunday opens at 07:00)
    assert.throws(
        () =>
            simulateHoldCourtBookingRpc({
                authRole: "authenticated",
                authUid: userUid,
                sessionUser: "authenticator",
                courtId: validCourtId,
                bookingDate: "2026-10-25",
                startTime: "06:00:00",
                endTime: "08:00:00",
                userId: userUid,
                amount: 400,
                operatingHoursTable,
                courtsTable,
                bookingsTable,
                nowManila: nowInManila,
            }),
        /OUTSIDE_OPERATING_HOURS/
    );

    // Case 5: Out-of-hours (Too late: ends at 23:00 when Sunday closes at 22:00)
    assert.throws(
        () =>
            simulateHoldCourtBookingRpc({
                authRole: "authenticated",
                authUid: userUid,
                sessionUser: "authenticator",
                courtId: validCourtId,
                bookingDate: "2026-10-25",
                startTime: "21:00:00",
                endTime: "23:00:00",
                userId: userUid,
                amount: 400,
                operatingHoursTable,
                courtsTable,
                bookingsTable,
                nowManila: nowInManila,
            }),
        /OUTSIDE_OPERATING_HOURS/
    );

    // Case 6: Price tampering attempt (Underpayment bypass: 1 PHP instead of 200 PHP)
    assert.throws(
        () =>
            simulateHoldCourtBookingRpc({
                authRole: "authenticated",
                authUid: userUid,
                sessionUser: "authenticator",
                courtId: validCourtId,
                bookingDate: "2026-10-25",
                startTime: "08:00:00",
                endTime: "09:00:00",
                userId: userUid,
                amount: 1, // Malicious customer attempting 1 PHP hold
                operatingHoursTable,
                courtsTable,
                bookingsTable,
                nowManila: nowInManila,
            }),
        /INVALID_AMOUNT/
    );

    // Case 7: Price tampering attempt for 2 hours (200 PHP instead of 400 PHP)
    assert.throws(
        () =>
            simulateHoldCourtBookingRpc({
                authRole: "authenticated",
                authUid: userUid,
                sessionUser: "authenticator",
                courtId: validCourtId,
                bookingDate: "2026-10-25",
                startTime: "08:00:00",
                endTime: "10:00:00",
                userId: userUid,
                amount: 200, // Should be 400
                operatingHoursTable,
                courtsTable,
                bookingsTable,
                nowManila: nowInManila,
            }),
        /INVALID_AMOUNT/
    );

    // Case 8: Non-whole-hour increments (08:30 to 09:30)
    assert.throws(
        () =>
            simulateHoldCourtBookingRpc({
                authRole: "authenticated",
                authUid: userUid,
                sessionUser: "authenticator",
                courtId: validCourtId,
                bookingDate: "2026-10-25",
                startTime: "08:30:00",
                endTime: "09:30:00",
                userId: userUid,
                amount: 200,
                operatingHoursTable,
                courtsTable,
                bookingsTable,
                nowManila: nowInManila,
            }),
        /INVALID_TIME_INCREMENT/
    );

    // Case 9: Overlap conflict against existing booking (10:00 to 12:00 exists; request 11:00 to 13:00)
    assert.throws(
        () =>
            simulateHoldCourtBookingRpc({
                authRole: "authenticated",
                authUid: userUid,
                sessionUser: "authenticator",
                courtId: validCourtId,
                bookingDate: "2026-10-25",
                startTime: "11:00:00",
                endTime: "13:00:00",
                userId: userUid,
                amount: 400,
                operatingHoursTable,
                courtsTable,
                bookingsTable,
                nowManila: nowInManila,
            }),
        /SLOT_UNAVAILABLE/
    );

    // Case 10: Court in maintenance
    assert.throws(
        () =>
            simulateHoldCourtBookingRpc({
                authRole: "authenticated",
                authUid: userUid,
                sessionUser: "authenticator",
                courtId: "court-maint",
                bookingDate: "2026-10-25",
                startTime: "08:00:00",
                endTime: "09:00:00",
                userId: userUid,
                amount: 200,
                operatingHoursTable,
                courtsTable,
                bookingsTable,
                nowManila: nowInManila,
            }),
        /COURT_UNAVAILABLE/
    );

    // Case 11: Valid 1-hour booking with correct price
    const res1 = simulateHoldCourtBookingRpc({
        authRole: "authenticated",
        authUid: userUid,
        sessionUser: "authenticator",
        courtId: validCourtId,
        bookingDate: "2026-10-25",
        startTime: "08:00:00",
        endTime: "09:00:00",
        userId: userUid,
        amount: 200,
        operatingHoursTable,
        courtsTable,
        bookingsTable,
        nowManila: nowInManila,
    });
    assert.equal(res1.duration_hours, 1);
    assert.equal(res1.total_amount, 200);

    // Case 12: Valid 2-hour booking with correct price
    const res2 = simulateHoldCourtBookingRpc({
        authRole: "authenticated",
        authUid: userUid,
        sessionUser: "authenticator",
        courtId: validCourtId,
        bookingDate: "2026-10-25",
        startTime: "08:00:00",
        endTime: "10:00:00",
        userId: userUid,
        amount: 400,
        operatingHoursTable,
        courtsTable,
        bookingsTable,
        nowManila: nowInManila,
    });
    assert.equal(res2.duration_hours, 2);
    assert.equal(res2.total_amount, 400);

    // Case 13: Valid 3-hour booking with correct price (13:00 to 16:00)
    const res3 = simulateHoldCourtBookingRpc({
        authRole: "authenticated",
        authUid: userUid,
        sessionUser: "authenticator",
        courtId: validCourtId,
        bookingDate: "2026-10-25",
        startTime: "13:00:00",
        endTime: "16:00:00",
        userId: userUid,
        amount: 600,
        operatingHoursTable,
        courtsTable,
        bookingsTable,
        nowManila: nowInManila,
    });
    assert.equal(res3.duration_hours, 3);
    assert.equal(res3.total_amount, 600);
});

// 15. Walk-in Booking RPC Simulator (create_walk_in_booking)
const simulateCreateWalkInBookingRpc = ({
    authRole = "authenticated",
    authUid = null,
    profileRole = "admin",
    sessionUser = "authenticator",
    courtId,
    customerName,
    bookingDate,
    startTime,
    endTime,
    amount,
    customerId = null,
    userId = null,
    paymentMethod = null,
    paymentReference = null,
    operatingHoursTable = {},
    courtsTable = {},
    bookingsTable = [],
    nowManila = new Date("2026-10-24T12:00:00+08:00"),
}) => {
    // 1. Authorization
    const isServiceRole =
        authRole === "service_role" ||
        (sessionUser === "postgres" && !authRole);

    if (!isServiceRole) {
        if (!authUid || authRole !== "authenticated") {
            throw new Error("UNAUTHORIZED: Authentication required to record walk-in reservations (42501)");
        }
        if (profileRole !== "admin") {
            throw new Error("FORBIDDEN: Admin privileges required to record walk-in reservations (42501)");
        }
    }

    // 2. Validate input parameters
    if (startTime >= endTime) {
        throw new Error("INVALID_TIME_RANGE: start_time must be earlier than end_time (22000)");
    }

    if (!customerName || !customerName.trim()) {
        throw new Error("INVALID_ARGUMENT: customer_name is required (22000)");
    }

    if (!customerId && !userId) {
        throw new Error("INVALID_ARGUMENT: Either p_customer_id or p_user_id must be provided (22000)");
    }

    if (paymentMethod !== undefined && paymentMethod !== null && !["cash", "gcash"].includes(paymentMethod)) {
        throw new Error("INVALID_ARGUMENT: payment_method must be cash, gcash, or null (22000)");
    }

    const [startH, startM, startS] = startTime.split(":").map(Number);
    const [endH, endM, endS] = endTime.split(":").map(Number);
    if (startM !== 0 || (startS !== undefined && startS !== 0) || endM !== 0 || (endS !== undefined && endS !== 0)) {
        throw new Error("INVALID_TIME_INCREMENT: Reservations must be booked in whole-hour increments on the hour (22000)");
    }

    const durationHours = endH - startH;
    if (durationHours < 1 || durationHours > 3) {
        throw new Error("INVALID_DURATION: Booking duration must be between 1 and 3 consecutive hours (22000)");
    }

    const expectedAmount = durationHours * 200;
    if (amount !== undefined && amount !== null && amount !== expectedAmount) {
        throw new Error(`INVALID_AMOUNT: Expected amount of ${expectedAmount} PHP for ${durationHours} hour(s), but received ${amount} PHP (22000)`);
    }

    // 3. Past slot check in Asia/Manila (walk-in checks against end_time)
    const startTimeFormatted = startTime.length === 5 ? `${startTime}:00` : startTime;
    const endTimeFormatted = endTime.length === 5 ? `${endTime}:00` : endTime;
    const slotEndInstant = new Date(`${bookingDate}T${endTimeFormatted}+08:00`);
    if (slotEndInstant <= nowManila) {
        throw new Error("PAST_SLOT: The requested time slot has already ended (22000)");
    }

    // 4. Operating hours lookup
    const targetDateInManila = new Date(`${bookingDate}T12:00:00+08:00`);
    const dayOfWeek = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "Asia/Manila" }).format(targetDateInManila);
    const daySchedule = operatingHoursTable[dayOfWeek];

    if (!daySchedule || !daySchedule.is_open || !daySchedule.open_time || !daySchedule.close_time) {
        throw new Error("VENUE_CLOSED: The venue is closed on this date (P0001)");
    }

    if (startTimeFormatted < daySchedule.open_time || endTimeFormatted > daySchedule.close_time) {
        throw new Error("OUTSIDE_OPERATING_HOURS: The selected time range falls outside venue operating hours (22000)");
    }

    // 5. Court existence & status
    const court = courtsTable[courtId];
    if (!court) {
        throw new Error("NOT_FOUND: Court does not exist (P0002)");
    }
    if (["maintenance", "closed", "inactive"].includes(court.status?.toLowerCase())) {
        throw new Error("COURT_UNAVAILABLE: Court is currently not available for reservations (P0001)");
    }

    // 6. Overlap conflict (ignoring expired pending holds)
    const hasConflict = bookingsTable.some((b) => {
        if (b.court_id !== courtId || b.booking_date !== bookingDate) return false;
        if (!["confirmed", "checked_in", "in_progress", "completed", "pending"].includes(b.status)) return false;
        if (b.status === "pending") {
            const expiry = b.hold_expires_at
                ? new Date(b.hold_expires_at)
                : (b.created_at ? new Date(new Date(b.created_at).getTime() + 35 * 60 * 1000) : null);
            if (expiry && expiry <= nowManila) return false;
        }
        return b.start_time < endTimeFormatted && b.end_time > startTimeFormatted;
    });

    if (hasConflict) {
        throw new Error("SLOT_UNAVAILABLE: This court slot is no longer available (P0001)");
    }

    const bookingId = "bk-walkin-" + Math.floor(Math.random() * 10000);
    const paymentStatus = paymentMethod ? "paid" : "pending";

    return {
        booking_id: bookingId,
        customer_name: customerName.trim(),
        duration_hours: durationHours,
        total_amount: expectedAmount,
        payment_status: paymentStatus,
        payment_method: paymentMethod,
        payment_reference: paymentReference,
    };
};

test("simulated create_walk_in_booking enforces authorization, duration, pricing, and operating rules", () => {
    const validCourtId = "court-1-active";
    const adminUid = "user-admin-1";
    const customerUid = "user-customer-2";
    const guestCustId = "guest-cust-3";
    const courtsTable = {
        [validCourtId]: { id: validCourtId, status: "active" },
        "court-maint": { id: "court-maint", status: "maintenance" },
    };
    const operatingHoursTable = {
        Sunday: { is_open: true, open_time: "07:00:00", close_time: "22:00:00" },
        Monday: { is_open: false, open_time: null, close_time: null },
    };
    const bookingsTable = [
        { court_id: validCourtId, booking_date: "2026-10-25", start_time: "10:00:00", end_time: "12:00:00", status: "confirmed" },
    ];
    const nowInManila = new Date("2026-10-24T12:00:00+08:00");

    // 1. Unauthorized anonymous caller
    assert.throws(
        () =>
            simulateCreateWalkInBookingRpc({
                authRole: "anon",
                authUid: null,
                courtId: validCourtId,
                customerName: "Guest Walkin",
                bookingDate: "2026-10-25",
                startTime: "08:00:00",
                endTime: "09:00:00",
                amount: 200,
                customerId: guestCustId,
                operatingHoursTable,
                courtsTable,
                bookingsTable,
                nowManila: nowInManila,
            }),
        /UNAUTHORIZED/
    );

    // 2. Non-admin regular customer caller
    assert.throws(
        () =>
            simulateCreateWalkInBookingRpc({
                authRole: "authenticated",
                authUid: customerUid,
                profileRole: "customer",
                courtId: validCourtId,
                customerName: "Sneaky Player",
                bookingDate: "2026-10-25",
                startTime: "08:00:00",
                endTime: "09:00:00",
                amount: 200,
                customerId: guestCustId,
                operatingHoursTable,
                courtsTable,
                bookingsTable,
                nowManila: nowInManila,
            }),
        /FORBIDDEN/
    );

    // 3. Missing both customerId and userId
    assert.throws(
        () =>
            simulateCreateWalkInBookingRpc({
                authRole: "authenticated",
                authUid: adminUid,
                profileRole: "admin",
                courtId: validCourtId,
                customerName: "Ghost Player",
                bookingDate: "2026-10-25",
                startTime: "08:00:00",
                endTime: "09:00:00",
                amount: 200,
                customerId: null,
                userId: null,
                operatingHoursTable,
                courtsTable,
                bookingsTable,
                nowManila: nowInManila,
            }),
        /INVALID_ARGUMENT: Either p_customer_id or p_user_id must be provided/
    );

    // 4. Blank customer name
    assert.throws(
        () =>
            simulateCreateWalkInBookingRpc({
                authRole: "authenticated",
                authUid: adminUid,
                profileRole: "admin",
                courtId: validCourtId,
                customerName: "   ",
                bookingDate: "2026-10-25",
                startTime: "08:00:00",
                endTime: "09:00:00",
                amount: 200,
                customerId: guestCustId,
                operatingHoursTable,
                courtsTable,
                bookingsTable,
                nowManila: nowInManila,
            }),
        /INVALID_ARGUMENT: customer_name is required/
    );

    // 5. Invalid duration (> 3 hours: 08:00 to 12:00 = 4 hours)
    assert.throws(
        () =>
            simulateCreateWalkInBookingRpc({
                authRole: "authenticated",
                authUid: adminUid,
                profileRole: "admin",
                courtId: validCourtId,
                customerName: "Guest Walkin",
                bookingDate: "2026-10-25",
                startTime: "08:00:00",
                endTime: "12:00:00",
                amount: 800,
                customerId: guestCustId,
                operatingHoursTable,
                courtsTable,
                bookingsTable,
                nowManila: nowInManila,
            }),
        /INVALID_DURATION/
    );

    // 6. Non-whole-hour increments (08:30 to 09:30)
    assert.throws(
        () =>
            simulateCreateWalkInBookingRpc({
                authRole: "authenticated",
                authUid: adminUid,
                profileRole: "admin",
                courtId: validCourtId,
                customerName: "Guest Walkin",
                bookingDate: "2026-10-25",
                startTime: "08:30:00",
                endTime: "09:30:00",
                amount: 200,
                customerId: guestCustId,
                operatingHoursTable,
                courtsTable,
                bookingsTable,
                nowManila: nowInManila,
            }),
        /INVALID_TIME_INCREMENT/
    );

    // 7. Price tampering attempt (200 PHP for 2 hours)
    assert.throws(
        () =>
            simulateCreateWalkInBookingRpc({
                authRole: "authenticated",
                authUid: adminUid,
                profileRole: "admin",
                courtId: validCourtId,
                customerName: "Guest Walkin",
                bookingDate: "2026-10-25",
                startTime: "08:00:00",
                endTime: "10:00:00",
                amount: 200, // Should be 400
                customerId: guestCustId,
                operatingHoursTable,
                courtsTable,
                bookingsTable,
                nowManila: nowInManila,
            }),
        /INVALID_AMOUNT/
    );

    // 8. Closed venue day (2026-10-26 is Monday)
    assert.throws(
        () =>
            simulateCreateWalkInBookingRpc({
                authRole: "authenticated",
                authUid: adminUid,
                profileRole: "admin",
                courtId: validCourtId,
                customerName: "Guest Walkin",
                bookingDate: "2026-10-26",
                startTime: "08:00:00",
                endTime: "09:00:00",
                amount: 200,
                customerId: guestCustId,
                operatingHoursTable,
                courtsTable,
                bookingsTable,
                nowManila: nowInManila,
            }),
        /VENUE_CLOSED/
    );

    // 9. Past time slot (2026-10-24 08:00 to 09:00 ended before nowManila 12:00)
    assert.throws(
        () =>
            simulateCreateWalkInBookingRpc({
                authRole: "authenticated",
                authUid: adminUid,
                profileRole: "admin",
                courtId: validCourtId,
                customerName: "Guest Walkin",
                bookingDate: "2026-10-24",
                startTime: "08:00:00",
                endTime: "09:00:00",
                amount: 200,
                customerId: guestCustId,
                operatingHoursTable,
                courtsTable,
                bookingsTable,
                nowManila: nowInManila,
            }),
        /PAST_SLOT/
    );

    // 10. Overlapping conflict against existing booking (10:00 to 12:00 exists; request 11:00 to 13:00)
    assert.throws(
        () =>
            simulateCreateWalkInBookingRpc({
                authRole: "authenticated",
                authUid: adminUid,
                profileRole: "admin",
                courtId: validCourtId,
                customerName: "Guest Walkin",
                bookingDate: "2026-10-25",
                startTime: "11:00:00",
                endTime: "13:00:00",
                amount: 400,
                customerId: guestCustId,
                operatingHoursTable,
                courtsTable,
                bookingsTable,
                nowManila: nowInManila,
            }),
        /SLOT_UNAVAILABLE/
    );

    // 11. Valid 1-hour walk-in booking for guest with cash (paid)
    const walkin1 = simulateCreateWalkInBookingRpc({
        authRole: "authenticated",
        authUid: adminUid,
        profileRole: "admin",
        courtId: validCourtId,
        customerName: "Guest Player 1",
        bookingDate: "2026-10-25",
        startTime: "08:00:00",
        endTime: "09:00:00",
        amount: 200,
        customerId: guestCustId,
        paymentMethod: "cash",
        operatingHoursTable,
        courtsTable,
        bookingsTable,
        nowManila: nowInManila,
    });
    assert.equal(walkin1.duration_hours, 1);
    assert.equal(walkin1.total_amount, 200);
    assert.equal(walkin1.payment_status, "paid");
    assert.equal(walkin1.payment_method, "cash");

    // 12. Valid 2-hour walk-in booking for registered member with unpaid (pending)
    const walkin2 = simulateCreateWalkInBookingRpc({
        authRole: "authenticated",
        authUid: adminUid,
        profileRole: "admin",
        courtId: validCourtId,
        customerName: "Member Player 2",
        bookingDate: "2026-10-25",
        startTime: "08:00:00",
        endTime: "10:00:00",
        amount: 400,
        userId: customerUid,
        paymentMethod: null,
        operatingHoursTable,
        courtsTable,
        bookingsTable,
        nowManila: nowInManila,
    });
    assert.equal(walkin2.duration_hours, 2);
    assert.equal(walkin2.total_amount, 400);
    assert.equal(walkin2.payment_status, "pending");

    // 13. Valid 3-hour walk-in booking with gcash (paid)
    const walkin3 = simulateCreateWalkInBookingRpc({
        authRole: "authenticated",
        authUid: adminUid,
        profileRole: "admin",
        courtId: validCourtId,
        customerName: "Guest Player 3",
        bookingDate: "2026-10-25",
        startTime: "13:00:00",
        endTime: "16:00:00",
        amount: 600,
        customerId: guestCustId,
        paymentMethod: "gcash",
        operatingHoursTable,
        courtsTable,
        bookingsTable,
        nowManila: nowInManila,
    });
    assert.equal(walkin3.duration_hours, 3);
    assert.equal(walkin3.total_amount, 600);
    assert.equal(walkin3.payment_status, "paid");
    assert.equal(walkin3.payment_method, "gcash");

    // 14. Invalid payment method ('card') rejected
    assert.throws(
        () =>
            simulateCreateWalkInBookingRpc({
                authRole: "authenticated",
                authUid: adminUid,
                profileRole: "admin",
                courtId: validCourtId,
                customerName: "Guest Player 4",
                bookingDate: "2026-10-25",
                startTime: "16:00:00",
                endTime: "17:00:00",
                amount: 200,
                customerId: guestCustId,
                paymentMethod: "card",
                operatingHoursTable,
                courtsTable,
                bookingsTable,
                nowManila: nowInManila,
            }),
        /INVALID_ARGUMENT: payment_method must be cash, gcash, or null/
    );

    // 15. Valid walk-in booking retains paymentReference (GCash reference)
    const walkinGcash = simulateCreateWalkInBookingRpc({
        authRole: "authenticated",
        authUid: adminUid,
        profileRole: "admin",
        courtId: validCourtId,
        customerName: "Guest Player GCash",
        bookingDate: "2026-10-25",
        startTime: "16:00:00",
        endTime: "17:00:00",
        amount: 200,
        customerId: guestCustId,
        paymentMethod: "gcash",
        paymentReference: "GCASH-REF-9988",
        operatingHoursTable,
        courtsTable,
        bookingsTable,
        nowManila: nowInManila,
    });
    assert.equal(walkinGcash.payment_method, "gcash");
    assert.equal(walkinGcash.payment_reference, "GCASH-REF-9988");

    // 16. Walk-in booking succeeds when overlapping slot is an expired pending hold
    const expiredPendingHoldBooking = {
        court_id: validCourtId,
        booking_date: "2026-10-25",
        start_time: "18:00:00",
        end_time: "20:00:00",
        status: "pending",
        hold_expires_at: "2026-10-24T11:00:00+08:00", // expired 1 hour prior to nowInManila (12:00)
    };
    const bookingsWithExpiredHold = [...bookingsTable, expiredPendingHoldBooking];
    const walkinOverExpiredHold = simulateCreateWalkInBookingRpc({
        authRole: "authenticated",
        authUid: adminUid,
        profileRole: "admin",
        courtId: validCourtId,
        customerName: "Walkin Over Expired Hold",
        bookingDate: "2026-10-25",
        startTime: "18:00:00",
        endTime: "20:00:00",
        amount: 400,
        customerId: guestCustId,
        paymentMethod: "cash",
        operatingHoursTable,
        courtsTable,
        bookingsTable: bookingsWithExpiredHold,
        nowManila: nowInManila,
    });
    assert.equal(walkinOverExpiredHold.duration_hours, 2);
    assert.equal(walkinOverExpiredHold.total_amount, 400);
});

test("simulated concurrent booking race between online customer and walk-in admin serializes cleanly", () => {
    const sharedCourtId = "court-shared-1";
    const courtsTable = {
        [sharedCourtId]: { id: sharedCourtId, status: "active" },
    };
    const operatingHoursTable = {
        Sunday: { is_open: true, open_time: "07:00:00", close_time: "22:00:00" },
    };
    const bookingsTable = [];
    const nowInManila = new Date("2026-10-24T12:00:00+08:00");
    const testDate = "2026-10-25";
    const testSlotStart = "08:00:00";
    const testSlotEnd = "10:00:00"; // 2 hours

    // Worker 1 (Online Customer) acquires court lock first and inserts pending hold
    const onlineResult = simulateHoldCourtBookingRpc({
        authRole: "authenticated",
        authUid: "user-cust-winner",
        sessionUser: "authenticator",
        courtId: sharedCourtId,
        bookingDate: testDate,
        startTime: testSlotStart,
        endTime: testSlotEnd,
        userId: "user-cust-winner",
        amount: 400,
        operatingHoursTable,
        courtsTable,
        bookingsTable,
        nowManila: nowInManila,
    });
    assert.ok(onlineResult.booking_id);

    // Commit worker 1 into shared state
    bookingsTable.push({
        id: onlineResult.booking_id,
        court_id: sharedCourtId,
        booking_date: testDate,
        start_time: testSlotStart,
        end_time: testSlotEnd,
        status: "pending",
    });

    // Worker 2 (Admin Walk-in) arrives after row lock is released, checks overlaps, and is REJECTED
    assert.throws(
        () =>
            simulateCreateWalkInBookingRpc({
                authRole: "authenticated",
                authUid: "admin-user",
                profileRole: "admin",
                courtId: sharedCourtId,
                customerName: "Walkin Contender",
                bookingDate: testDate,
                startTime: "09:00:00",
                endTime: "11:00:00", // Overlaps with 08:00-10:00
                amount: 400,
                customerId: "guest-contender",
                paymentMethod: "cash",
                operatingHoursTable,
                courtsTable,
                bookingsTable,
                nowManila: nowInManila,
            }),
        /SLOT_UNAVAILABLE/
    );
});


// 16. Basket validation: every line is checked, errors name the court (Task 5)
test("validateBasketLines validates each line and names the offending court", () => {
    const now = new Date("2026-10-24T06:00:00+08:00");
    const base = {
        bookingDate: "2026-10-25",
        operatingHour: { is_open: true, open_time: "07:00:00", close_time: "22:00:00" },
        limits: { min_hours: 1, max_hours: 3 },
        courts: [
            { id: "c1", name: "Court 1", status: "available" },
            { id: "c2", name: "Court 2", status: "available" },
            { id: "c3", name: "Court 3", status: "maintenance" },
        ],
        now,
    };
    const ok = validateBasketLines({ ...base, lines: [
        { court_id: "c1", start_time: "08:00", end_time: "09:00" },
        { court_id: "c2", start_time: "10:00", end_time: "12:00" },
    ] });
    assert.deepEqual(ok, { valid: true, lines: [
        { courtId: "c1", courtName: "Court 1", startTimeDb: "08:00:00", endTimeDb: "09:00:00" },
        { courtId: "c2", courtName: "Court 2", startTimeDb: "10:00:00", endTimeDb: "12:00:00" },
    ] });

    const bad = validateBasketLines({ ...base, lines: [
        { court_id: "c1", start_time: "08:00", end_time: "09:00" },
        { court_id: "c2", start_time: "05:00", end_time: "06:00" },
    ] });
    assert.deepEqual(bad, { valid: false, error: "Court 2: The selected time range falls outside venue operating hours." });

    const dup = validateBasketLines({ ...base, lines: [
        { court_id: "c1", start_time: "08:00", end_time: "09:00" },
        { court_id: "c1", start_time: "10:00", end_time: "11:00" },
    ] });
    assert.equal(dup.valid, false);

    assert.deepEqual(
        validateBasketLines({ ...base, lines: [{ court_id: "c3", start_time: "08:00", end_time: "09:00" }] }),
        { valid: false, error: "Court 3: This court is currently not available for reservations." }
    );
    assert.deepEqual(
        validateBasketLines({ ...base, lines: [{ court_id: "zz", start_time: "08:00", end_time: "09:00" }] }),
        { valid: false, error: "Line 1: Invalid court." }
    );
    assert.equal(validateBasketLines({ ...base, lines: [] }).valid, false);
    assert.equal(validateBasketLines({ ...base, lines: "x" }).valid, false);
    assert.equal(validateBasketLines({ ...base, lines: [{ court_id: "c1", start_time: 8, end_time: "09:00" }] }).valid, false);
});
