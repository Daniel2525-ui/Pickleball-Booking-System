import test from "node:test";
import assert from "node:assert/strict";
import { compactRange, quickStarts, pickCourts } from "../src/lib/services/bookings/quickStarts.ts";

const slots = ["8:00 AM - 9:00 AM", "9:00 AM - 10:00 AM", "10:00 AM - 11:00 AM", "11:00 AM - 12:00 PM"];
const taken = new Set(["COURT 2|9:00 AM - 10:00 AM"]);
const isFree = (court, slot) => !taken.has(`${court}|${slot}`);

test("compactRange spans the whole run of hours", () => {
    assert.equal(compactRange(slots, 0, 1), "8AM-9AM");
    assert.equal(compactRange(slots, 2, 2), "10AM-12PM");
});

test("quickStarts keeps only courts free for every hour, and drops starts that run past closing", () => {
    const starts = quickStarts(slots, ["COURT 1", "COURT 2"], 2, isFree);
    assert.deepEqual(starts.map((s) => s.slot), slots.slice(0, 3));
    assert.deepEqual(starts[0].freeCourts, ["COURT 1"]);
    assert.deepEqual(starts[2].freeCourts, ["COURT 1", "COURT 2"]);
    assert.deepEqual(quickStarts(slots, ["COURT 1"], 5, isFree), []);
});

test("pickCourts keeps still-free choices and fills the rest in order", () => {
    assert.deepEqual(pickCourts(["COURT 1", "COURT 3", "COURT 4"], ["COURT 4", "COURT 2"], 2), ["COURT 4", "COURT 1"]);
    assert.deepEqual(pickCourts(["COURT 1"], [], 3), ["COURT 1"]);
});
