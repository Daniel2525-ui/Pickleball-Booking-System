import test from "node:test";
import assert from "node:assert/strict";
import { compactRange, hourRangeLabel } from "../src/lib/services/bookings/quickStarts.ts";

const slots = ["8:00 AM - 9:00 AM", "9:00 AM - 10:00 AM", "10:00 AM - 11:00 AM", "11:00 AM - 12:00 PM"];

test("compactRange spans the whole run of hours", () => {
    assert.equal(compactRange(slots, 0, 1), "8AM-9AM");
    assert.equal(compactRange(slots, 2, 2), "10AM-12PM");
});


test("hourRangeLabel: one AM/PM when both ends share it, both across noon or midnight", () => {
    assert.equal(hourRangeLabel("8:00 AM - 9:00 AM"), "8–9 AM");
    assert.equal(hourRangeLabel("9:00 PM - 10:00 PM"), "9–10 PM");
    assert.equal(hourRangeLabel("11:00 AM - 12:00 PM"), "11 AM–12 PM");
    assert.equal(hourRangeLabel("11:00 PM - 12:00 AM"), "11 PM–12 AM");
    assert.equal(hourRangeLabel("12:00 AM - 1:00 AM"), "12–1 AM");
});
