import test from "node:test";
import assert from "node:assert/strict";
import {
    validateBookingSlot,
    getBookingWeekday,
    validateBasketLines,
    heldOnTheirDates,
} from "../src/lib/services/bookings/validateBookingSlot.service.ts";
import { getBookingStart } from "../src/lib/utils/bookingTime.ts";
import { businessDayWindows } from "../src/lib/services/schedule/hoursRules.ts";

// 3. Admin-configured duration limits are enforced (pricing itself: tests/quote-court-price.test.mjs)
test("validateBookingSlot enforces the configured minimum and has no maximum length", () => {
    const now = new Date("2026-10-24T06:00:00+08:00");
    const slot = (endTime, limits) => validateBookingSlot({ bookingDate: "2026-10-25", startTime: "08:00", endTime, now, limits });
    assert.equal(slot("10:00", { min_hours: 2 }).valid, true);
    // A whole day in one booking is fine
    assert.equal(slot("20:00", { min_hours: 2 }).valid, true);
    assert.deepEqual(slot("09:00", { min_hours: 2 }), { valid: false, error: "Bookings must be at least 2 hours long, in whole hours." });
});

// 4. Server-side Time and Duration Validation (Production validateBookingSlot)
test("validateBookingSlot accepts valid 1, 2, and 3-hour bookings", () => {
    const futureTime = new Date("2026-10-24T06:00:00+08:00");
    const openVenue = [{ start: "07:00", end: "22:00" }];

    const oneHour = validateBookingSlot({
        limits: { min_hours: 1, max_hours: 3 },
        bookingDate: "2026-10-25",
        startTime: "08:00",
        endTime: "09:00",
        windows: openVenue,
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
        windows: openVenue,
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
        windows: openVenue,
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
        { valid: false, error: "Bookings must be at least 1 hour long, in whole hours." }
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
        { valid: false, error: "Bookings must be at least 1 hour long, in whole hours." }
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
    const venueHours = [{ start: "06:00", end: "22:00" }];

    // Valid: right at open time
    assert.equal(
        validateBookingSlot({
        limits: { min_hours: 1, max_hours: 3 },
            bookingDate: "2026-10-25",
            startTime: "06:00",
            endTime: "08:00",
            windows: venueHours,
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
            windows: venueHours,
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
            windows: venueHours,
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
            windows: venueHours,
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
            windows: [],
            now: futureTime,
        }),
        { valid: false, error: "The venue is closed on this date." }
    );
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

// 16. Basket validation: every line is checked, errors name the court (Task 5)
test("validateBasketLines validates each line and names the offending court", () => {
    const now = new Date("2026-10-24T06:00:00+08:00");
    const base = {
        bookingDate: "2026-10-25",
        windows: [{ start: "07:00", end: "22:00" }],
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
        { courtId: "c1", courtName: "Court 1", bookingDate: "2026-10-25", startTimeDb: "08:00:00", endTimeDb: "09:00:00" },
        { courtId: "c2", courtName: "Court 2", bookingDate: "2026-10-25", startTimeDb: "10:00:00", endTimeDb: "12:00:00" },
    ] });

    const bad = validateBasketLines({ ...base, lines: [
        { court_id: "c1", start_time: "08:00", end_time: "09:00" },
        { court_id: "c2", start_time: "05:00", end_time: "06:00" },
    ] });
    assert.deepEqual(bad, { valid: false, error: "Court 2: The selected time range falls outside venue operating hours." });

    // Separate times on the same court are allowed, and so are back-to-back ones
    const separate = validateBasketLines({ ...base, lines: [
        { court_id: "c1", start_time: "08:00", end_time: "09:00" },
        { court_id: "c1", start_time: "09:00", end_time: "10:00" },
        { court_id: "c1", start_time: "14:00", end_time: "15:00" },
    ] });
    assert.equal(separate.valid, true);

    const overlap = validateBasketLines({ ...base, lines: [
        { court_id: "c1", start_time: "08:00", end_time: "10:00" },
        { court_id: "c1", start_time: "09:00", end_time: "11:00" },
    ] });
    assert.deepEqual(overlap, { valid: false, error: "Court 1: two of your times overlap." });

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

// A night's after-midnight hours are booked with its day, stored on the next date
test("validateBasketLines takes a date per line and counts the minimum across midnight", () => {
    const open = (day, o, c) => ({ day_of_week: day, is_open: true, open_time: o, close_time: c });
    const hours = [open("Friday", "22:00", "02:00"), open("Saturday", "08:00", "22:00")];
    const base = {
        bookingDate: "2026-11-06",
        windows: businessDayWindows("2026-11-06", hours),
        limits: { min_hours: 2 },
        courts: [{ id: "c1", name: "Court 1", status: "active" }, { id: "c2", name: "Court 2", status: "active" }],
        now: new Date("2026-11-05T12:00:00+08:00"),
    };
    const line = (court_id, booking_date, start_time, end_time) => ({ court_id, booking_date, start_time, end_time });

    const run = validateBasketLines({ ...base, lines: [line("c1", "2026-11-06", "23:00", "24:00"), line("c1", "2026-11-07", "00:00", "01:00")] });
    assert.deepEqual(run, { valid: true, lines: [
        { courtId: "c1", courtName: "Court 1", bookingDate: "2026-11-06", startTimeDb: "23:00:00", endTimeDb: "24:00:00" },
        { courtId: "c1", courtName: "Court 1", bookingDate: "2026-11-07", startTimeDb: "00:00:00", endTimeDb: "01:00:00" },
    ] });
    // Alone, one after-midnight hour is under the 2-hour minimum; so is an hour that doesn't join it on another court
    assert.deepEqual(validateBasketLines({ ...base, lines: [line("c1", "2026-11-07", "00:00", "01:00")] }),
        { valid: false, error: "Court 1: Bookings must be at least 2 hours long, in whole hours." });
    assert.equal(validateBasketLines({ ...base, lines: [line("c1", "2026-11-06", "23:00", "24:00"), line("c2", "2026-11-07", "00:00", "01:00")] }).valid, false);
    assert.equal(validateBasketLines({ ...base, lines: [line("c1", "2026-11-07", "00:00", "02:00")] }).valid, true);

    const outside = "Court 1: The selected time range falls outside venue operating hours.";
    assert.deepEqual(validateBasketLines({ ...base, lines: [line("c1", "2026-11-07", "02:00", "04:00")] }), { valid: false, error: outside });
    assert.deepEqual(validateBasketLines({ ...base, lines: [line("c1", "2026-11-08", "00:00", "02:00")] }), { valid: false, error: outside });
    // Saturday's own morning is not part of Friday's booking day
    assert.deepEqual(validateBasketLines({ ...base, lines: [line("c1", "2026-11-07", "08:00", "10:00")] }), { valid: false, error: outside });

    assert.deepEqual(validateBasketLines({ ...base, lines: [line("c1", "2026-11-07", "00:00", "02:00"), line("c1", "2026-11-07", "01:00", "02:00")] }),
        { valid: false, error: "Court 1: two of your times overlap." });
    // Same clock hours on different dates don't overlap
    assert.equal(validateBasketLines({ ...base, limits: { min_hours: 1 }, lines: [line("c1", "2026-11-06", "23:00", "24:00"), line("c1", "2026-11-07", "00:00", "01:00")] }).valid, true);
    assert.deepEqual(validateBasketLines({ ...base, lines: [{ court_id: "c1", booking_date: 7, start_time: "00:00", end_time: "02:00" }] }),
        { valid: false, error: "Line 1: Missing required booking details." });
});

// An older hold_court_basket ignores line dates: its holds must be caught, not paid for on the wrong night
test("heldOnTheirDates checks the database held each line on its own date", () => {
    const lines = [
        { courtId: "c1", courtName: "Court 1", bookingDate: "2026-11-06", startTimeDb: "23:00:00", endTimeDb: "24:00:00" },
        { courtId: "c1", courtName: "Court 1", bookingDate: "2026-11-07", startTimeDb: "00:00:00", endTimeDb: "01:00:00" },
    ];
    const item = (court_id, booking_date, start_time) => ({ court_id, booking_date, start_time });
    assert.equal(heldOnTheirDates(lines, [item("c1", "2026-11-06", "23:00:00"), item("c1", "2026-11-07", "00:00:00")]), true);
    assert.equal(heldOnTheirDates(lines, [item("c1", "2026-11-06", "23:00:00"), item("c1", undefined, "00:00:00")]), false);
    assert.equal(heldOnTheirDates(lines, [item("c1", "2026-11-06", "23:00:00"), item("c1", "2026-11-06", "00:00:00")]), false);
});
