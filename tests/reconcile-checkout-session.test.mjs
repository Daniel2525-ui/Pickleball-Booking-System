import test from "node:test";
import assert from "node:assert/strict";

process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_dummy_for_tests";
const { checkoutTargets, reconcileCheckoutSession, expireCheckoutSession } = await import("../src/lib/services/payments/reconcileCheckoutSession.ts");
const { processStripePaymentReconciliation } = await import("../src/lib/services/payments/processStripePaymentReconciliation.ts");

const rowA = { booking_id: "b-A", payment_id: "p-A", amount: 250, currency: "php", status: "pending" };
const rowB = { booking_id: "b-B", payment_id: "p-B", amount: 300, currency: "php", status: "pending" };

test("checkoutTargets: basket metadata targets exactly its payment_ids, each with its own amount", () => {
    assert.deepEqual(checkoutTargets({ basket_id: "bk-1", payment_ids: "p-A,p-B" }, [rowA, rowB]), [
        { bookingId: "b-A", paymentId: "p-A", amount: 250, currency: "php" },
        { bookingId: "b-B", paymentId: "p-B", amount: 300, currency: "php" },
    ]);
    // A row the session did not charge (a court added to, or moved into, the basket later) is ignored
    const extra = { booking_id: "b-X", payment_id: "p-X", amount: 200, currency: "php", status: "pending" };
    assert.deepEqual(checkoutTargets({ basket_id: "bk-1", payment_ids: "p-A" }, [rowA, rowB, extra]).map((t) => t.paymentId), ["p-A"]);
    assert.deepEqual(checkoutTargets({ basket_id: "bk-1" }, [rowA, rowB]), []);
});

test("checkoutTargets: metadata without payment_ids targets nothing", () => {
    assert.deepEqual(checkoutTargets({}, [rowA, rowB]), []);
});

// Chainable stand-in for supabase.from(...).select().eq().in() resolving to the given rows
function mockSupabase(rows, rpc) {
    const filters = [];
    const builder = {
        select: () => builder,
        eq: (col, val) => (filters.push(["eq", col, val]), builder),
        in: (col, vals) => (filters.push(["in", col, vals]), builder),
        then: (resolve, reject) => Promise.resolve({ data: rows, error: null }).then(resolve, reject),
    };
    return { filters, client: { from: () => builder, rpc } };
}

const basketSession = { id: "cs_basket", metadata: { basket_id: "bk-1", payment_ids: "p-A,p-B" }, payment_intent: "pi_basket", amount_total: 55000, currency: "php" };

test("reconcileCheckoutSession: each court reconciles with its own amount; one failure still attempts the rest", async () => {
    const calls = [];
    const { filters, client } = mockSupabase([rowA, rowB], async (fn, params) => {
        assert.equal(fn, "reconcile_booking_payment");
        calls.push(params);
        if (params.p_booking_id === "b-A") return { data: null, error: { message: "boom" } };
        return { data: { action: "CONFIRMED" }, error: null };
    });

    const res = await reconcileCheckoutSession(basketSession, client);

    assert.deepEqual(filters, [["eq", "bookings.basket_id", "bk-1"], ["in", "id", ["p-A", "p-B"]]]);
    assert.deepEqual(calls.map((c) => [c.p_booking_id, c.p_payment_id, c.p_amount, c.p_stripe_session_id, c.p_stripe_payment_intent]), [
        ["b-A", "p-A", 250, "cs_basket", "pi_basket"],
        ["b-B", "p-B", 300, "cs_basket", "pi_basket"],
    ]);
    assert.deepEqual(res.confirmed, ["b-B"]);
    assert.ok(res.error && res.error.includes("boom"), res.error);
});

test("reconcileCheckoutSession: a refunded court is reported, the rest confirmed, no error", async () => {
    const { client } = mockSupabase([rowA, rowB], async (fn, params) => {
        if (params.p_booking_id === "b-A") return { data: { action: "REFUND_SCHEDULED", reason: "SLOT_CONFLICT" }, error: null };
        return { data: { action: "CONFIRMED" }, error: null };
    });
    const res = await reconcileCheckoutSession(basketSession, client);
    assert.deepEqual(res, { confirmed: ["b-B"], refunded: [{ bookingId: "b-A", reason: "SLOT_CONFLICT" }], error: null });
});

test("reconcileCheckoutSession: no matching rows is an error so Stripe retries", async () => {
    const { client } = mockSupabase([], async () => assert.fail("no RPC expected"));
    const res = await reconcileCheckoutSession(basketSession, client);
    assert.ok(res.error);
});

test("reconcileCheckoutSession: rows that do not add up to the Stripe charge, or another currency, reconcile nothing", async () => {
    const { client } = mockSupabase([rowA, rowB], async () => assert.fail("no RPC expected"));
    for (const session of [
        { ...basketSession, amount_total: 25000 },
        { ...basketSession, currency: "usd" },
    ]) {
        const res = await reconcileCheckoutSession(session, client);
        assert.ok(res.error && res.error.includes("not reconciled"), res.error);
        assert.deepEqual(res.confirmed, []);
    }
    const upper = await reconcileCheckoutSession({ ...basketSession, currency: "PHP" }, mockSupabase([rowA, rowB], async () => ({ data: { action: "CONFIRMED" }, error: null })).client);
    assert.deepEqual(upper, { confirmed: ["b-A", "b-B"], refunded: [], error: null });
});

test("reconcileCheckoutSession: metadata without basket_id or payment_ids is an error, nothing loaded", async () => {
    const { filters, client } = mockSupabase([rowA, rowB], async () => assert.fail("no RPC expected"));
    for (const metadata of [{ basket_id: "bk-1" }, { booking_id: "b-B", payment_id: "p-B" }]) {
        const res = await reconcileCheckoutSession({ ...basketSession, metadata }, client);
        assert.ok(res.error && res.error.includes("Missing metadata"), res.error);
    }
    assert.deepEqual(filters, []);
});

test("expireCheckoutSession: cancels only pending rows; a session without a basket is ignored", async () => {
    const cancels = [];
    const rpc = async (fn, params) => (cancels.push([fn, params.p_booking_id, params.p_payment_id]), { data: { cancelled: true }, error: null });
    const { client } = mockSupabase([rowA, { ...rowB, status: "paid" }], rpc);
    await expireCheckoutSession(basketSession, client);
    assert.deepEqual(cancels, [["cancel_expired_booking", "b-A", "p-A"]]);

    cancels.length = 0;
    await expireCheckoutSession({ id: "cs_old", metadata: { booking_id: "b-L", payment_id: "p-L" } }, client);
    assert.deepEqual(cancels, []);
});

test("processStripePaymentReconciliation: inline refund passes the court's amount in centavos", async () => {
    let refundParams;
    const supabase = {
        rpc: async (fn) => fn === "reconcile_booking_payment"
            ? { data: { action: "REFUND_SCHEDULED", reason: "SLOT_CONFLICT", idempotency_key: "ref_conflict_p-A", refund_request_id: "rr-1" }, error: null }
            : { data: { success: true }, error: null },
    };
    await processStripePaymentReconciliation({
        bookingId: "b-A", paymentId: "p-A", amount: 250, currency: "php",
        stripeSessionId: "cs_basket", stripePaymentIntent: "pi_basket", supabase,
        stripeClient: { refunds: { create: async (params) => ((refundParams = params), { id: "re_1", status: "succeeded" }) } },
    });
    assert.deepEqual(refundParams, { payment_intent: "pi_basket", amount: 25000 });
});
