import test from "node:test";
import assert from "node:assert/strict";
import { upsertLine, removeLine, basketTotal, pendingBasketSize, splitTakenLines, groupByCheckout, checkoutTotal } from "../src/lib/services/bookings/basket.ts";

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

test("splitTakenLines drops lines that are no longer free and names them", () => {
    const { kept, dropped } = splitTakenLines([a, b], (l) => l.court === "Court 1");
    assert.deepEqual(kept, [a]);
    assert.deepEqual(dropped, [b]);
});

test("groupByCheckout groups one checkout's courts, in first-seen order; null baskets stay alone", () => {
    const r = (id, basket_id) => ({ id, basket_id });
    const rows = [r("1", "A"), r("2", null), r("3", "B"), r("4", "A"), r("5", null), r("6", undefined)];
    assert.deepEqual(groupByCheckout(rows).map((g) => g.map((x) => x.id)), [["1", "4"], ["2"], ["3"], ["5"], ["6"]]);
});

test("checkoutTotal counts live courts, or every court when all were cancelled", () => {
    const l = (status, total_amount) => ({ status, total_amount });
    assert.equal(checkoutTotal([l("confirmed", 510), l("cancelled", 255), l("confirmed", 300)]), 810);
    assert.equal(checkoutTotal([l("cancelled", 300), l("no_show", 300)]), 600);
    assert.equal(checkoutTotal([l("pending", 300), l("pending", null)]), 300);
});
