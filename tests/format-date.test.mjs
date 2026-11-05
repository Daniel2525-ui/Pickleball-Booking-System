import test from "node:test";
import assert from "node:assert/strict";
import { formatDate, formatShortDate } from "../src/lib/utils/formatTime.ts";

test("venue dates read the same in any time zone", () => {
    // A date-only value is the Manila calendar day, never shifted
    assert.equal(formatShortDate("2026-11-06"), "Fri, Nov 6");
    assert.equal(formatDate("2026-11-06"), "Nov 6, 2026");
    // A timestamp is shown in Manila time: 23:30 UTC on Nov 5 is Nov 6 in Manila
    assert.equal(formatDate("2026-11-05T23:30:00Z"), "Nov 6, 2026");
    assert.equal(formatDate("2026-11-05T23:30:00Z", true), "Nov 6, 2026, 7:30 AM");
});

test("formatDate shows a dash for missing or broken values", () => {
    assert.equal(formatDate(null), "—");
    assert.equal(formatDate(undefined), "—");
    assert.equal(formatDate("not a date"), "—");
});
