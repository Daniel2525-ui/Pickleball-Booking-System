import test from "node:test";
import assert from "node:assert/strict";
import { compactRange } from "../src/lib/services/bookings/quickStarts.ts";

const slots = ["8:00 AM - 9:00 AM", "9:00 AM - 10:00 AM", "10:00 AM - 11:00 AM", "11:00 AM - 12:00 PM"];

test("compactRange spans the whole run of hours", () => {
    assert.equal(compactRange(slots, 0, 1), "8AM-9AM");
    assert.equal(compactRange(slots, 2, 2), "10AM-12PM");
});

