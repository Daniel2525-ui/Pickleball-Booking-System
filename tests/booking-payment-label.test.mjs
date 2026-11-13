import test from "node:test";
import assert from "node:assert/strict";
import { bookingPaymentLabel } from "../src/lib/services/payments/paymentsTypes.ts";

test("bookingPaymentLabel says where the money is", () => {
    const live = { status: "confirmed" };
    assert.equal(bookingPaymentLabel(live, { status: "pending" }), "Unpaid");
    assert.equal(bookingPaymentLabel(live, { status: "paid", payment_method: "cash" }), "Paid • Cash");
    assert.equal(bookingPaymentLabel(live, { status: "paid", payment_method: "stripe" }), "Paid • QR Ph");
    assert.equal(bookingPaymentLabel(live, { status: "refunded" }), "refunded");
    // Cancelled but still paid: the money is held, so never plain "Paid"
    assert.equal(bookingPaymentLabel({ status: "cancelled", cancel_reason: "admin" }, { status: "paid", payment_method: "cash" }), "Paid · cancelled");
    assert.equal(bookingPaymentLabel({ status: "cancelled", cancel_reason: "payment_kept" }, { status: "paid" }), "Payment kept");
});
