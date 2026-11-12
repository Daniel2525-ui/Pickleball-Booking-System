import test from "node:test";
import assert from "node:assert/strict";
import { lineKey, mergeSpans, splitAtMidnight, removeLine, basketTotal, pendingBasketSize, splitTakenLines, groupByCheckout, checkoutTotal, settleHold } from "../src/lib/services/bookings/basket.ts";

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

test("mergeSpans joins touching ranges on a court, however long the result", () => {
    // 8-9 and 9-10 become 8-10; 2-3 PM stays apart; input order doesn't matter
    assert.deepEqual(mergeSpans([[6, 7], [0, 1], [1, 2]]), [[0, 2], [6, 7]]);
    // Filling the gap joins all three
    assert.deepEqual(mergeSpans([[0, 1], [2, 3], [1, 2]]), [[0, 3]]);
    // No maximum length: a whole day joins into one booking
    assert.deepEqual(mergeSpans([[0, 6], [6, 14]]), [[0, 14]]);
    assert.deepEqual(mergeSpans([]), []);
});

test("splitAtMidnight stores a run across midnight as two bookings, one on each date", () => {
    const friday = ["10:00 PM - 11:00 PM", "11:00 PM - 12:00 AM", "12:00 AM - 1:00 AM", "1:00 AM - 2:00 AM"];
    assert.deepEqual(splitAtMidnight(friday, [1, 3], "2026-11-06"), [
        { booking_date: "2026-11-06", start_time: "23:00", end_time: "24:00" },
        { booking_date: "2026-11-07", start_time: "00:00", end_time: "01:00" },
    ]);
    assert.deepEqual(splitAtMidnight(friday, [2, 4], "2026-11-06"), [{ booking_date: "2026-11-07", start_time: "00:00", end_time: "02:00" }]);
    assert.deepEqual(splitAtMidnight(friday, [0, 1], "2026-11-06"), [{ booking_date: "2026-11-06", start_time: "22:00", end_time: "23:00" }]);
    assert.deepEqual(splitAtMidnight(friday, [0, 2], "2026-11-30"), [{ booking_date: "2026-11-30", start_time: "22:00", end_time: "24:00" }]);
    assert.deepEqual(splitAtMidnight(friday, [3, 4], "2026-12-31"), [{ booking_date: "2027-01-01", start_time: "01:00", end_time: "02:00" }]);
});
