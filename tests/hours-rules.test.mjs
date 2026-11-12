import test from "node:test";
import assert from "node:assert/strict";
import { checkWeeklyHours, isOutsideHours, bookableWindows } from "../src/lib/services/schedule/hoursRules.ts";
import { validateBookingSlot } from "../src/lib/services/bookings/validateBookingSlot.service.ts";
import { formatTime12h } from "../src/lib/utils/formatTime.ts";
import { getBookingEnd, businessDate, businessToday, lateNightLabel, lateNightOf } from "../src/lib/utils/bookingTime.ts";
import { generateTimeSlots } from "../src/lib/services/schedule/generateTimeSlots.service.ts";
import { walkInStarts, walkInEnds } from "../src/lib/services/bookings/walkInSlots.ts";
import { slotTimes } from "../src/lib/services/bookings/checkSlotAvailability.service.ts";
import { mergeSpans } from "../src/lib/services/bookings/basket.ts";
import { quoteCourtPrice } from "../src/lib/services/pricing/quoteCourtPrice.ts";
import { venueDayWindow } from "../src/lib/services/payments/paymentsTypes.ts";
import { summarizeVenueHours } from "../src/lib/utils/venueHours.ts";
import { renderBookingEmail } from "../src/lib/services/bookings/bookingEmails.ts";

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

// After-midnight hours. 2026-11-06 is a Friday, 2026-11-07 a Saturday, 2026-11-08 a Sunday
const lateWeek = [open("Thursday", "08:00", "00:00"), open("Friday", "22:00", "02:00"), open("Saturday", "08:00", "22:00"), { day_of_week: "Sunday", is_open: false }];

test("checkWeeklyHours accepts closing after midnight up to the day's end", () => {
    assert.ok(checkWeeklyHours([open("Friday", "22:00", "02:00")]).rows);
    assert.ok(checkWeeklyHours([open("Friday", "08:00", "00:00")]).rows);
    assert.ok(checkWeeklyHours([open("Friday", "08:00", "04:00")]).rows);
    assert.match(checkWeeklyHours([open("Friday", "08:00", "05:00")]).error, /after midnight up to 4:00 AM/);
    assert.ok(checkWeeklyHours([open("Friday", "08:00", "05:00")], "06:00:00").rows);
    assert.match(checkWeeklyHours([open("Friday", "03:00", "22:00")]).error, /earlier than 4:00 AM/);
});

test("bookableWindows gives a date the previous day's late-night tail and its own hours", () => {
    assert.deepEqual(bookableWindows("2026-11-06", lateWeek), [{ start: "22:00", end: "24:00" }]); // Thursday closes at midnight: no tail
    assert.deepEqual(bookableWindows("2026-11-07", lateWeek), [{ start: "00:00", end: "02:00", lateNight: true }, { start: "08:00", end: "22:00" }]);
    // A closed date closes its business day: Friday closed takes Saturday's late night, Saturday closed keeps it
    assert.deepEqual(bookableWindows("2026-11-07", lateWeek, ["2026-11-06"]), [{ start: "08:00", end: "22:00" }]);
    assert.deepEqual(bookableWindows("2026-11-07", lateWeek, ["2026-11-07"]), [{ start: "00:00", end: "02:00", lateNight: true }]);
    assert.deepEqual(bookableWindows("2026-11-08", lateWeek), []);
});

test("isOutsideHours follows late-night hours and never joins them to the morning", () => {
    const slot = (booking_date, start_time, end_time) => isOutsideHours({ booking_date, start_time, end_time }, lateWeek);
    assert.equal(slot("2026-11-06", "23:00:00", "24:00:00"), false);
    assert.equal(slot("2026-11-07", "01:00:00", "02:00:00"), false);
    assert.equal(slot("2026-11-07", "02:00:00", "03:00:00"), true);
    assert.equal(slot("2026-11-07", "01:00:00", "09:00:00"), true);
    assert.equal(slot("2026-11-06", "21:00:00", "22:00:00"), true);
    assert.equal(slot("2026-11-07", "21:00:00", "22:00:00"), false); // a normal day is unchanged
    assert.equal(slot("2026-11-07", "22:00:00", "23:00:00"), true);
});

test("a booking can end at 24:00 and formats as 12:00 AM", () => {
    const now = new Date("2026-11-05T06:00:00+08:00");
    const windows = bookableWindows("2026-11-06", lateWeek);
    const ok = validateBookingSlot({ bookingDate: "2026-11-06", startTime: "23:00", endTime: "24:00", windows, limits: { min_hours: 1 }, now });
    assert.deepEqual([ok.valid, ok.durationHours, ok.endTimeDb], [true, 1, "24:00:00"]);
    assert.equal(validateBookingSlot({ bookingDate: "2026-11-06", startTime: "21:00", endTime: "23:00", windows, limits: { min_hours: 1 }, now }).valid, false);
    assert.equal(validateBookingSlot({ bookingDate: "2026-11-06", startTime: "23:00", endTime: "25:00", windows, limits: { min_hours: 1 }, now }).valid, false);
    assert.equal(formatTime12h("24:00:00"), "12:00 AM");
    assert.equal(formatTime12h("00:00"), "12:00 AM");
    assert.equal(formatTime12h("12:00"), "12:00 PM");
    assert.equal(getBookingEnd({ booking_date: "2026-11-06", start_time: "23:00:00", end_time: "24:00:00" }).toISOString(), "2026-11-06T16:00:00.000Z");
});

test("the business day: hours before the cutoff belong to the day before", () => {
    assert.equal(businessDate("2026-11-07", "01:00:00"), "2026-11-06");
    assert.equal(businessDate("2026-11-07", "04:00:00"), "2026-11-07");
    assert.equal(businessDate("2026-11-07", "01:00:00", "00:00:00"), "2026-11-07");
    assert.equal(businessDate("2026-11-01", "00:00"), "2026-10-31");
    assert.equal(businessToday("04:00:00", new Date("2026-11-07T01:30:00+08:00")), "2026-11-06");
    assert.equal(businessToday("04:00:00", new Date("2026-11-07T04:00:00+08:00")), "2026-11-07");
    assert.equal(lateNightLabel("2026-11-07", "01:00:00"), "Friday late night");
    assert.equal(lateNightLabel("2026-11-07", "08:00:00"), null);
    assert.equal(lateNightOf({ booking_date: "2026-11-07", business_date: "2026-11-06" }), "Friday late night");
    assert.equal(lateNightOf({ booking_date: "2026-11-07", business_date: "2026-11-07" }), null);
    assert.equal(lateNightOf({ booking_date: "2026-11-07" }), null);
    // The desk's day for money runs cutoff to cutoff
    assert.deepEqual(venueDayWindow("2026-11-06", "04:00:00"), { start: "2026-11-05T20:00:00.000Z", end: "2026-11-06T20:00:00.000Z" });
});

test("the customer grid lists late-night slots first and a slot can end at midnight", () => {
    const at = (d) => new Date(`${d}T12:00:00+08:00`);
    assert.deepEqual(generateTimeSlots(at("2026-11-06"), lateWeek), ["10:00 PM - 11:00 PM", "11:00 PM - 12:00 AM"]);
    const saturday = generateTimeSlots(at("2026-11-07"), lateWeek);
    assert.deepEqual(saturday.slice(0, 3), ["12:00 AM - 1:00 AM", "1:00 AM - 2:00 AM", "8:00 AM - 9:00 AM"]);
    assert.equal(saturday.length, 16);
    assert.deepEqual(generateTimeSlots(at("2026-11-07"), lateWeek, ["2026-11-06"]).slice(0, 1), ["8:00 AM - 9:00 AM"]);
    assert.deepEqual(generateTimeSlots(at("2026-11-08"), lateWeek), []);
    assert.deepEqual(slotTimes("11:00 PM - 12:00 AM"), { start: "23:00", end: "24:00" });
    assert.deepEqual(slotTimes("12:00 AM - 1:00 AM"), { start: "00:00", end: "01:00" });
    // 1-2 AM (slot 1) and 8-9 AM (slot 2) touch in the list but never join: slot 2 starts after a gap
    assert.deepEqual(mergeSpans([[0, 2], [2, 3]], new Set([2])), [[0, 2], [2, 3]]);
    assert.deepEqual(mergeSpans([[0, 2], [2, 3]]), [[0, 3]]);
});

test("the walk-in picker offers late-night starts and keeps ends inside their window", () => {
    const input = { date: "2026-11-07", courtId: "c1", courtStatus: "active", hours: lateWeek, closedDates: [], bookings: [], minHours: 1 };
    assert.deepEqual(walkInStarts(input).map((s) => s.time).slice(0, 3), ["00:00", "01:00", "08:00"]);
    assert.deepEqual(walkInEnds(input, "00:00"), ["01:00", "02:00"]);
    assert.deepEqual(walkInEnds({ ...input, date: "2026-11-06" }, "22:00"), ["23:00", "24:00"]);
    assert.deepEqual(walkInStarts({ ...input, closedDates: ["2026-11-06"] }).map((s) => s.time)[0], "08:00");
});

test("a Friday peak rate covers Friday's late-night hours", () => {
    const pricing = { settings: { base_hourly_rate: 200, min_hours: 1, max_hours: 12, day_ends_at: "04:00:00" }, peakRates: [{ label: "Late", days: ["Friday"], start_time: "00:00", end_time: "02:00", hourly_rate: 500 }, { label: "Night", days: ["Friday"], start_time: "22:00", end_time: "24:00", hourly_rate: 300 }] };
    assert.equal(quoteCourtPrice(pricing, "2026-11-07", "00:00", 2).total, 1000); // Saturday 12-2 AM is Friday business
    assert.equal(quoteCourtPrice(pricing, "2026-11-06", "00:00", 2).total, 400); // Friday 12-2 AM is Thursday business
    assert.equal(quoteCourtPrice(pricing, "2026-11-06", "22:00", 2).total, 600); // a window can run to midnight
});

test("summaries and emails read late hours correctly", () => {
    const summary = summarizeVenueHours([open("Friday", "08:00", "02:00"), open("Saturday", "07:00", "23:00")]);
    assert.equal(summary.range, "7 AM – 2 AM");
    const email = renderBookingEmail("confirmation", { to: "a@b.c", name: "Ana", rows: [{ id: "1", booking_date: "2026-11-07", business_date: "2026-11-06", start_time: "00:00:00", end_time: "02:00:00", customer_name: "Ana", courts: { name: "Court 1" } }] }, { phone: "0917", phoneHref: "tel:0917", email: "play@venue.ph", address: "Butuan" });
    assert.match(email.text, /Court 1 · Sat, Nov 7 · 12:00 AM – 2:00 AM \(Friday late night\)/);
});
