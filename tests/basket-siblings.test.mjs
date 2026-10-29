import test from "node:test";
import assert from "node:assert/strict";
import { counterSettlementDue, siblingSessionIds, pendingPaymentIds } from "../src/lib/services/bookings/basketSiblings.ts";

const row = (id, fields = {}) => ({
    id,
    basket_id: "bk-1",
    status: "pending",
    total_amount: 999,
    payments: [{ id: `p-${id}`, status: "pending", amount: 250 }],
    ...fields,
});

test("counterSettlementDue: unpaid basket sums every pending court's own payment amount", () => {
    const a = row("a");
    const b = row("b", { payments: [{ id: "p-b", status: "pending", amount: "300.50" }] });
    const paid = row("c", { status: "confirmed", payments: [{ id: "p-c", status: "paid", amount: 400 }] });
    const other = row("d", { basket_id: "bk-2" });
    const failedPayment = row("e", { payments: [{ id: "p-e", status: "failed", amount: 500 }] });
    assert.deepEqual(counterSettlementDue(a, [a, b, paid, other, failedPayment]), { ids: ["a", "b"], total: 550.5 });
});

test("counterSettlementDue: legacy, confirmed or unlisted bookings stand alone", () => {
    const legacy = row("a", { basket_id: null });
    assert.deepEqual(counterSettlementDue(legacy, [legacy, row("b", { basket_id: null })]), { ids: ["a"], total: 999 });
    const confirmed = row("a", { status: "confirmed" });
    assert.deepEqual(counterSettlementDue(confirmed, [confirmed, row("b")]), { ids: ["a"], total: 999 });
    assert.deepEqual(counterSettlementDue(row("a"), [row("b")]), { ids: ["a"], total: 999 });
});

test("siblingSessionIds / pendingPaymentIds: one shared session, only pending payments", () => {
    const sibs = [
        { payments: [{ id: "p1", status: "pending", stripe_session_id: "cs_1" }, { id: "p1b", status: "paid", stripe_session_id: "cs_9" }] },
        { payments: [{ id: "p2", status: "failed", stripe_session_id: "cs_1" }] },
        { payments: [] },
    ];
    assert.deepEqual(siblingSessionIds(sibs), ["cs_1"]);
    assert.deepEqual(pendingPaymentIds(sibs), ["p1"]);
});
