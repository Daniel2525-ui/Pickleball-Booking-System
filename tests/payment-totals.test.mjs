import test from "node:test";
import assert from "node:assert/strict";
import { sumPayments, paymentMethodLabel, venueDayWindow } from "../src/lib/services/payments/paymentsTypes.ts";

test("sumPayments counts money in when paid and refunds when returned", () => {
    const totals = sumPayments(
        [
            { status: "paid", amount: "200.00", payment_method: "cash" },
            { status: "paid", amount: 300, payment_method: "gcash" },
            { status: "paid", amount: 400, payment_method: "stripe" },
            { status: "paid", amount: 100, payment_method: null }, // older online payment
            { status: "refunded", amount: 250, payment_method: "stripe" }, // paid this day, refunded later: still came in
            { status: "pending", amount: 999, payment_method: null },
            { status: "failed", amount: 999, payment_method: "stripe" },
        ],
        [
            { amount: 150, payment_method: "cash" }, // handed back from the drawer this day
            { amount: "80", payment_method: "gcash" },
        ]
    );
    assert.deepEqual(totals, { collected: 1250, cash: 200, gcash: 300, card: 750, collectedCount: 5, refunded: 230, refundedCount: 2, refundedCash: 150 });
});

test("paymentMethodLabel names the method staff recognise", () => {
    assert.equal(paymentMethodLabel({ status: "paid", payment_method: "cash" }), "Cash");
    assert.equal(paymentMethodLabel({ status: "paid", payment_method: "gcash", payment_reference: "7741" }), "QR Ph");
    assert.equal(paymentMethodLabel({ status: "paid", payment_method: null }), "QR Ph");
    assert.equal(paymentMethodLabel({ status: "pending", payment_method: null }), "Not paid yet");
});

test("venueDayWindow covers one Manila day", () => {
    assert.deepEqual(venueDayWindow("2026-11-05"), { start: "2026-11-04T16:00:00.000Z", end: "2026-11-05T16:00:00.000Z" });
});
