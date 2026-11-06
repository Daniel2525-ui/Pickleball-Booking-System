import test from "node:test";
import assert from "node:assert/strict";
import { lineKey, mergeSpans, removeLine, basketTotal, pendingBasketSize, splitTakenLines, groupByCheckout, checkoutTotal, settleHold } from "../src/lib/services/bookings/basket.ts";

const a = { court: "Court 1", price: 200, hasPeak: false, startSlot: "8:00 AM - 9:00 AM" };
const b = { court: "Court 2", price: 300, hasPeak: true, startSlot: "8:00 AM - 9:00 AM" };
const a2 = { ...a, startSlot: "2:00 PM - 3:00 PM" };

test("removeLine drops only that range", () => {
    assert.deepEqual(removeLine([a, b, a2], lineKey(a)), [b, a2]);
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

test("settleHold: an expired hold releases the whole basket, a confirmed result only the court it checked", () => {
    const r = (id, basket_id, status) => ({ id, basket_id, status, cancel_reason: null });
    const rows = [r("1", "A", "pending"), r("2", "A", "pending"), r("3", "A", "confirmed"), r("4", "B", "pending")];
    const after = (status) => settleHold(rows, rows[0], status, status === "cancelled" ? "expired" : null).map((b) => b.status);
    assert.deepEqual(after("cancelled"), ["cancelled", "cancelled", "confirmed", "pending"]);
    // A sibling may have been lost to the late payment, so it waits for a refresh instead of reading as confirmed
    assert.deepEqual(after("confirmed"), ["confirmed", "pending", "confirmed", "pending"]);
});

test("mergeSpans joins touching ranges on a court, up to the max booking length", () => {
    // 8-9 and 9-10 become 8-10; 2-3 PM stays apart; input order doesn't matter
    assert.deepEqual(mergeSpans([[6, 7], [0, 1], [1, 2]], 6), [[0, 2], [6, 7]]);
    // Filling the gap joins all three
    assert.deepEqual(mergeSpans([[0, 1], [2, 3], [1, 2]], 6), [[0, 3]]);
    // Past the max length they stay separate bookings
    assert.deepEqual(mergeSpans([[0, 2], [2, 4]], 3), [[0, 2], [2, 4]]);
    assert.deepEqual(mergeSpans([], 3), []);
});
