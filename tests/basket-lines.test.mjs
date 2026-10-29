import test from "node:test";
import assert from "node:assert/strict";
import { upsertLine, removeLine, basketTotal, pendingBasketSize } from "../src/lib/services/bookings/basket.ts";

const a = { court: "Court 1", price: 200, hasPeak: false };
const b = { court: "Court 2", price: 300, hasPeak: true };

test("upsertLine adds a new court and replaces an existing one in place", () => {
    assert.deepEqual(upsertLine([a], b), [a, b]);
    assert.deepEqual(upsertLine([a, b], { ...a, price: 400 }), [{ ...a, price: 400 }, b]);
});

test("removeLine drops only that court", () => {
    assert.deepEqual(removeLine([a, b], "Court 1"), [b]);
});

test("basketTotal sums prices and flags peak if any line has it", () => {
    assert.deepEqual(basketTotal([a, b]), { total: 500, hasPeak: true });
    assert.deepEqual(basketTotal([a]), { total: 200, hasPeak: false });
    assert.deepEqual(basketTotal([]), { total: 0, hasPeak: false });
});

test("pendingBasketSize counts pending siblings; legacy NULL basket is alone", () => {
    const rows = [
        { basket_id: "x", status: "pending" },
        { basket_id: "x", status: "pending" },
        { basket_id: "x", status: "confirmed" },
        { basket_id: null, status: "pending" },
    ];
    assert.equal(pendingBasketSize(rows, rows[0]), 2);
    assert.equal(pendingBasketSize(rows, rows[3]), 1);
});
