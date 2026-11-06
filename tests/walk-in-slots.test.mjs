import test from "node:test";
import assert from "node:assert/strict";
import { walkInStarts, walkInEnds } from "../src/lib/services/bookings/walkInSlots.ts";

const base = {
    date: "2026-11-09", // Monday
    courtId: "c1",
    courtStatus: "available",
    hours: [{ day_of_week: "Monday", is_open: true, open_time: "08:00:00", close_time: "12:00:00" }],
    closedDates: [],
    bookings: [],
    minHours: 1,
    maxHours: 3,
};
const booking = (over) => ({ id: null, court_id: "c1", start_time: "09:00:00", end_time: "10:00:00", status: "confirmed", ...over });

test("starts cover open to close minus min length", () => {
    assert.deepEqual(walkInStarts(base).map((s) => s.time), ["08:00", "09:00", "10:00", "11:00"]);
});
test("booked hour is marked taken", () => {
    const b = { ...base, bookings: [booking()] };
    assert.deepEqual(walkInStarts(b).filter((s) => s.taken).map((s) => s.time), ["09:00"]);
    assert.deepEqual(walkInEnds(b, "09:00"), []);
});
test("other court's booking does not block", () => {
    const b = { ...base, bookings: [booking({ court_id: "c2" })] };
    assert.equal(walkInStarts(b).some((s) => s.taken), false);
});
test("ignores inactive bookings", () => {
    const b = { ...base, bookings: [booking({ status: "cancelled" })] };
    assert.equal(walkInStarts(b).some((s) => s.taken), false);
});
test("ends stop before the next taken hour", () => {
    const b = { ...base, bookings: [booking({ start_time: "10:00:00", end_time: "11:00:00" })] };
    assert.deepEqual(walkInEnds(b, "08:00"), ["09:00", "10:00"]);
});
test("ends respect max length and closing", () => {
    assert.deepEqual(walkInEnds(base, "08:00"), ["09:00", "10:00", "11:00"]);
    assert.deepEqual(walkInEnds(base, "11:00"), ["12:00"]);
});
test("min length above 1 hour", () => {
    const b = { ...base, minHours: 2 };
    assert.deepEqual(walkInStarts(b).map((s) => s.time), ["08:00", "09:00", "10:00"]);
    assert.deepEqual(walkInEnds(b, "10:00"), ["12:00"]);
});
test("no starts when closed", () => {
    for (const b of [
        { ...base, closedDates: ["2026-11-09"] },
        { ...base, courtStatus: "maintenance" },
        { ...base, courtStatus: "closed" },
        { ...base, date: "2026-11-10" }, // Tuesday has no hours row
    ]) {
        assert.deepEqual(walkInStarts(b), []);
        assert.deepEqual(walkInEnds(b, "08:00"), []);
    }
});
test("past starts today stay selectable", () => {
    const b = { ...base, now: new Date("2026-11-09T10:30:00+08:00") };
    assert.equal(walkInStarts(b).find((s) => s.time === "08:00").taken, false);
});
