import test from "node:test";
import assert from "node:assert/strict";

process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_dummy_for_tests";
const { processPendingRefundJobs } = await import("../src/lib/services/payments/refundWorker.ts");

test("RefundWorker: successfully claims and processes pending refund job with 'claimed: true'", async () => {
    let claimedRpcCalls = 0;
    let settledRpcCalls = 0;
    let stripeRefundCalls = 0;

    const mockJob = {
        id: "ref-req-1",
        payment_id: "pay-1",
        amount: 200,
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
                assert.equal(params.p_amount, 200);
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
        rpc: async (fn, params) => {
            if (fn === "claim_pending_refund_request") {
                return { data: { claimed: true, refund_request: mockJob }, error: null };
            }
            if (fn === "settle_stripe_refund") {
                settledRpcCalls++;
                assert.equal(params.p_stripe_status, "succeeded");
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
