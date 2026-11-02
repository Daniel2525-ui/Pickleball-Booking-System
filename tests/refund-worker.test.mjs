import test from "node:test";
import assert from "node:assert/strict";

process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_dummy_for_tests";
const { processPendingRefundJobs, settleRefundFromStripe } = await import("../src/lib/services/payments/refundWorker.ts");

test("RefundWorker: successfully claims and processes pending refund job with 'claimed: true'", async () => {
    let claimedRpcCalls = 0;
    let settledRpcCalls = 0;
    let stripeRefundCalls = 0;

    const mockJob = {
        id: "ref-req-1",
        payment_id: "pay-1",
        amount: 250,
        currency: "PHP",
        stripe_payment_intent: "pi_test_123",
        idempotency_key: "idemp_test_123",
    };

    const mockSupabase = {
        rpc: async (fn, params) => {
            if (fn === "claim_pending_refund_request") {
                claimedRpcCalls++;
                if (claimedRpcCalls === 1) {
                    // SQL returns { claimed: true, refund_request: ... }
                    return { data: { claimed: true, refund_request: mockJob }, error: null };
                }
                return { data: { claimed: false }, error: null };
            }
            if (fn === "settle_stripe_refund") {
                settledRpcCalls++;
                assert.equal(params.p_refund_request_id, "ref-req-1");
                assert.equal(params.p_stripe_status, "succeeded");
                assert.equal(params.p_amount, 250);
                assert.equal(params.p_currency, "php");
                return { data: { success: true }, error: null };
            }
            throw new Error(`Unexpected RPC: ${fn}`);
        },
    };

    const mockStripe = {
        refunds: {
            create: async (params, opts) => {
                stripeRefundCalls++;
                assert.equal(params.payment_intent, "pi_test_123");
                assert.equal(params.amount, 25000); // PHP 250 in centavos
                assert.equal(opts.idempotencyKey, "idemp_test_123");
                return { id: "re_test_123", status: "succeeded" };
            },
        },
    };

    const res = await processPendingRefundJobs({
        workerId: "worker-test-1",
        leaseSeconds: 30,
        maxJobs: 5,
        supabase: mockSupabase,
        stripeClient: mockStripe,
    });

    assert.equal(res.processed, 1);
    assert.equal(res.succeeded, 1);
    assert.equal(res.failed, 0);
    assert.equal(stripeRefundCalls, 1);
    assert.equal(settledRpcCalls, 1);
});

test("RefundWorker: exits cleanly when no available refund jobs ('claimed: false')", async () => {
    let claimedRpcCalls = 0;
    let settledRpcCalls = 0;

    const mockSupabase = {
        rpc: async (fn) => {
            if (fn === "claim_pending_refund_request") {
                claimedRpcCalls++;
                return { data: { claimed: false }, error: null };
            }
            if (fn === "settle_stripe_refund") {
                settledRpcCalls++;
                return { data: { success: true }, error: null };
            }
            throw new Error(`Unexpected RPC: ${fn}`);
        },
    };

    const res = await processPendingRefundJobs({
        workerId: "worker-empty-test",
        leaseSeconds: 30,
        maxJobs: 10,
        supabase: mockSupabase,
    });

    assert.equal(res.processed, 0);
    assert.equal(res.succeeded, 0);
    assert.equal(res.failed, 0);
    assert.equal(claimedRpcCalls, 1);
    assert.equal(settledRpcCalls, 0);
});

test("RefundWorker: retries failed or interrupted processing safely", async () => {
    let settleAttempts = 0;

    const mockJob = {
        id: "ref-req-retry",
        payment_id: "pay-retry",
        amount: 200,
        currency: "PHP",
        stripe_payment_intent: "pi_retry_123",
        idempotency_key: "idemp_retry_123",
    };

    const mockSupabase = {
        rpc: async (fn) => {
            if (fn === "claim_pending_refund_request") {
                return { data: { claimed: true, refund_request: mockJob }, error: null };
            }
            if (fn === "settle_stripe_refund") {
                settleAttempts++;
                // Simulate database error during settlement
                return { data: null, error: { message: "Transient DB error" } };
            }
            throw new Error(`Unexpected RPC: ${fn}`);
        },
    };

    const mockStripe = {
        refunds: {
            create: async () => ({ id: "re_retry_123", status: "succeeded" }),
        },
    };

    const res = await processPendingRefundJobs({
        workerId: "worker-retry-test",
        leaseSeconds: 30,
        maxJobs: 1,
        supabase: mockSupabase,
        stripeClient: mockStripe,
    });

    assert.equal(res.processed, 1);
    assert.equal(res.succeeded, 0);
    assert.equal(res.failed, 1);
    assert.equal(settleAttempts, 1);
});

// refund_requests rows already holding one of the listed Stripe refund ids (other requests only)
const ledgerWith = (rows) => ({
    from: () => ({ select: () => ({ in: () => ({ neq: async () => ({ data: rows, error: null }) }) }) }),
});

test("RefundWorker: handles 'charge_already_refunded' gracefully without duplicating refunds", async () => {
    let settledRpcCalls = 0;

    const mockJob = {
        id: "ref-req-dup",
        payment_id: "pay-dup",
        amount: 200,
        currency: "PHP",
        stripe_payment_intent: "pi_already_refunded",
        idempotency_key: "idemp_dup_123",
    };

    const mockSupabase = {
        ...ledgerWith([]),
        rpc: async (fn, params) => {
            if (fn === "claim_pending_refund_request") {
                return { data: { claimed: true, refund_request: mockJob }, error: null };
            }
            if (fn === "settle_stripe_refund") {
                settledRpcCalls++;
                assert.equal(params.p_stripe_status, "succeeded");
                // The real settle_stripe_refund rejects a succeeded settlement without a refund id
                assert.equal(params.p_stripe_refund_id, "re_from_dashboard");
                return { data: { success: true }, error: null };
            }
            throw new Error(`Unexpected RPC: ${fn}`);
        },
    };

    const mockStripe = {
        refunds: {
            create: async () => {
                const err = new Error("Charge already refunded");
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                err.code = "charge_already_refunded";
                throw err;
            },
            list: async ({ payment_intent }) => {
                assert.equal(payment_intent, "pi_already_refunded");
                return { data: [{ id: "re_from_dashboard", status: "succeeded" }] };
            },
        },
    };

    const res = await processPendingRefundJobs({
        workerId: "worker-dup-test",
        leaseSeconds: 30,
        maxJobs: 1,
        supabase: mockSupabase,
        stripeClient: mockStripe,
    });

    assert.equal(res.processed, 1);
    assert.equal(settledRpcCalls, 1);
});

test("RefundWorker: a dashboard refund already recorded for another court goes to admin review, not retried forever", async () => {
    // One Stripe dashboard refund covered a two-court basket; court A's request already recorded it
    let settledStatus = null;
    const mockSupabase = {
        ...ledgerWith([{ stripe_refund_id: "re_whole_basket" }]),
        rpc: async (fn, params) => {
            if (fn === "claim_pending_refund_request") {
                return { data: { claimed: true, refund_request: { id: "req-court-b", payment_id: "pay-b", amount: 200, currency: "PHP", stripe_payment_intent: "pi_basket", idempotency_key: "k-b" } }, error: null };
            }
            if (fn === "settle_stripe_refund") {
                settledStatus = params.p_stripe_status;
                assert.equal(params.p_stripe_refund_id, null);
                return { data: { success: true }, error: null };
            }
            throw new Error(`Unexpected RPC: ${fn}`);
        },
    };
    const mockStripe = {
        refunds: {
            create: async () => {
                const err = new Error("Charge already refunded");
                err.code = "charge_already_refunded";
                throw err;
            },
            list: async () => ({ data: [{ id: "re_whole_basket", status: "succeeded" }] }),
        },
    };

    await processPendingRefundJobs({ workerId: "w", maxJobs: 1, supabase: mockSupabase, stripeClient: mockStripe });
    // Not "succeeded" (would reuse court A's refund id) and not "uncertain"-style silence: staff review it
    assert.equal(settledStatus, "already_refunded");
});

// Stripe refund.updated / refund.failed: the ledger row recorded with that refund id is settled
const refundLedger = (row) => {
    const calls = [];
    return {
        calls,
        from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) }),
        rpc: async (fn, params) => { calls.push({ fn, params }); return { data: { success: true }, error: null }; },
    };
};
const ledgerRow = { id: "req-1", amount: 200, currency: "php", status: "requires_admin_review", stripe_payment_intent: "pi_1" };

test("settleRefundFromStripe: a refund that clears days later settles as succeeded with the ledger's amount", async () => {
    const db = refundLedger(ledgerRow);
    assert.equal(await settleRefundFromStripe({ id: "re_1", status: "succeeded", payment_intent: "pi_1" }, db), "settled");
    assert.equal(db.calls.length, 1);
    assert.deepEqual(db.calls[0], { fn: "settle_stripe_refund", params: {
        p_refund_request_id: "req-1", p_stripe_refund_id: "re_1", p_stripe_status: "succeeded",
        p_stripe_payment_intent: "pi_1", p_amount: 200, p_currency: "php",
    } });
});

test("settleRefundFromStripe: failed and canceled refunds settle as failed so staff can retry", async () => {
    for (const status of ["failed", "canceled"]) {
        const db = refundLedger(ledgerRow);
        assert.equal(await settleRefundFromStripe({ id: "re_1", status, payment_intent: "pi_1" }, db), "settled");
        assert.equal(db.calls[0].params.p_stripe_status, "failed");
    }
});

test("settleRefundFromStripe: ignores pending updates, unknown refunds and rows already refunded", async () => {
    const pending = refundLedger(ledgerRow);
    assert.equal(await settleRefundFromStripe({ id: "re_1", status: "pending" }, pending), "ignored");
    const unknown = refundLedger(null); // e.g. a refund made by hand in the Stripe dashboard
    assert.equal(await settleRefundFromStripe({ id: "re_x", status: "succeeded" }, unknown), "ignored");
    const done = refundLedger({ ...ledgerRow, status: "succeeded" });
    assert.equal(await settleRefundFromStripe({ id: "re_1", status: "succeeded" }, done), "ignored");
    for (const db of [pending, unknown, done]) assert.equal(db.calls.length, 0);
});
