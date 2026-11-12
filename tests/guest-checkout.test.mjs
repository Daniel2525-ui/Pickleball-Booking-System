import test from "node:test";
import assert from "node:assert/strict";
import { parseGuestDetails, checkPlayerCount, maxPlayers } from "../src/lib/services/bookings/guestDetails.ts";
import { applyDiscount, normaliseCode } from "../src/lib/services/pricing/discounts.ts";

test("guest details: name, a Philippine mobile number and an email, cleaned up", () => {
    assert.deepEqual(parseGuestDetails({ full_name: "  Juan Dela Cruz ", phone: "0917-123-4567", email: " Juan@Example.com " }), {
        ok: true,
        value: { full_name: "Juan Dela Cruz", phone: "09171234567", email: "juan@example.com" },
    });
    // +63 and 63 forms become 09...
    assert.equal(parseGuestDetails({ full_name: "Ana Reyes", phone: "+63 917 123 4567", email: "a@b.co" }).value.phone, "09171234567");
    assert.equal(parseGuestDetails({ full_name: "Ana Reyes", phone: "639171234567", email: "a@b.co" }).value.phone, "09171234567");
    const bad = (input) => parseGuestDetails({ full_name: "Ana Reyes", phone: "09171234567", email: "a@b.co", ...input });
    assert.match(bad({ full_name: "A" }).error, /name/i);
    assert.match(bad({ full_name: "x".repeat(101) }).error, /name/i);
    assert.match(bad({ phone: "0817123456" }).error, /mobile number/i);
    assert.match(bad({ phone: "02 8123 4567" }).error, /mobile number/i);
    assert.match(bad({ email: "not-an-email" }).error, /email/i);
    assert.equal(parseGuestDetails(null).ok, false);
    assert.equal(parseGuestDetails({ full_name: 5, phone: "09171234567", email: "a@b.co" }).ok, false);
});

test("number of players: required, whole, at least 1 and at most the courts' limit", () => {
    assert.equal(maxPlayers(8, 2), 16);
    assert.equal(maxPlayers(8, 0), 8);
    assert.equal(checkPlayerCount(4, 8), null);
    assert.equal(checkPlayerCount(8, 8), null);
    assert.match(checkPlayerCount(9, 8), /at most 8 players/);
    assert.match(checkPlayerCount(0, 8), /at least 1/);
    assert.match(checkPlayerCount(2.5, 8), /whole number/);
    assert.match(checkPlayerCount(undefined, 8), /number of players/i);
    assert.match(checkPlayerCount("4", 8), /number of players/i);
});

test("discount codes are trimmed and upper-cased, letters, digits and dashes, 3 to 20 long", () => {
    assert.equal(normaliseCode("  summer-10 "), "SUMMER-10");
    assert.equal(normaliseCode("ab"), null);
    assert.equal(normaliseCode("has space"), null);
    assert.equal(normaliseCode("x".repeat(21)), null);
    assert.equal(normaliseCode(7), null);
});

test("applyDiscount takes a percent off each line, or a fixed amount from the lines in order", () => {
    assert.deepEqual(applyDiscount([400, 200], { kind: "percent", value: 10 }), [360, 180]);
    // Rounded to centavos per line
    assert.deepEqual(applyDiscount([333], { kind: "percent", value: 15 }), [283.05]);
    // A fixed amount larger than the first line spills into the next, never below zero
    assert.deepEqual(applyDiscount([200, 400], { kind: "fixed", value: 250 }), [0, 350]);
    assert.deepEqual(applyDiscount([200, 400], { kind: "fixed", value: 1000 }), [0, 0]);
    assert.deepEqual(applyDiscount([200], { kind: "percent", value: 100 }), [0]);
});
