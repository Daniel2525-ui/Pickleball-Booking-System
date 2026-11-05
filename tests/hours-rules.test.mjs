import test from "node:test";
import assert from "node:assert/strict";
import { checkWeeklyHours, isOutsideHours } from "../src/lib/services/schedule/hoursRules.ts";

const open = (day, o, c) => ({ day_of_week: day, is_open: true, open_time: o, close_time: c });

test("checkWeeklyHours accepts whole hours and stores closed days without times", () => {
    const result = checkWeeklyHours([open("Monday", "08:00", "22:00"), { day_of_week: "Sunday", is_open: false, open_time: "08:00", close_time: "09:00" }]);
    assert.deepEqual(result, { rows: [open("Monday", "08:00", "22:00"), { day_of_week: "Sunday", is_open: false, open_time: null, close_time: null }] });
});

test("checkWeeklyHours rejects half hours, reversed times, unknown or repeated days", () => {
    assert.match(checkWeeklyHours([open("Monday", "08:30", "22:00")]).error, /whole hours/);
    assert.match(checkWeeklyHours([open("Monday", "22:00", "08:00")]).error, /later than opening/);
    assert.match(checkWeeklyHours([open("Funday", "08:00", "22:00")]).error, /only once/);
    assert.match(checkWeeklyHours([open("Monday", "08:00", "22:00"), open("Monday", "09:00", "21:00")]).error, /only once/);
    assert.equal(checkWeeklyHours([]).error, "Operating hours data is required.");
    assert.equal(checkWeeklyHours(null).error, "Operating hours data is required.");
});

test("isOutsideHours compares a booking with its weekday's hours", () => {
    const hours = [open("Friday", "08:00", "21:00"), { day_of_week: "Sunday", is_open: false }];
    // 2026-11-06 is a Friday, 2026-11-08 a Sunday
    assert.equal(isOutsideHours({ booking_date: "2026-11-06", start_time: "20:00:00", end_time: "21:00:00" }, hours), false);
    assert.equal(isOutsideHours({ booking_date: "2026-11-06", start_time: "21:00:00", end_time: "22:00:00" }, hours), true);
    assert.equal(isOutsideHours({ booking_date: "2026-11-06", start_time: "07:00:00", end_time: "08:00:00" }, hours), true);
    assert.equal(isOutsideHours({ booking_date: "2026-11-08", start_time: "10:00:00", end_time: "11:00:00" }, hours), true);
});
