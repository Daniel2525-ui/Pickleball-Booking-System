import { SupabaseClient } from "@supabase/supabase-js";
import { stripe } from "../../stripe.ts";
import { withDbRetry } from "./withDbRetry.ts";

export interface RefundStripeClient {
    refunds: {
        create: (
            params: { payment_intent: string; amount: number },
            options?: { idempotencyKey?: string }
        ) => Promise<{ id: string; status?: string | null }>;
        list: (params: { payment_intent: string; limit: number }) => Promise<{ data: { id: string; status?: string | null }[] }>;
    };
}

export interface ProcessRefundJobsOptions {
    workerId: string;
    leaseSeconds?: number;
    maxJobs?: number;
    supabase: SupabaseClient;
    stripeClient?: RefundStripeClient;
}

/**
 * Full refund of `amount` PHP, never throws. Status is Stripe's, or "succeeded" when the charge was
 * already refunded, "failed" for a terminal request error, "uncertain" for network errors (retried later).
 * `ledger` lets an already-refunded charge skip refund ids other requests recorded: one dashboard refund
 * can cover a whole basket, and it can settle only one court's request.
 */
export async function createStripeRefund(
    stripeClient: RefundStripeClient,
    paymentIntent: string,
    amount: number,
    idempotencyKey: string,
    ledger?: { supabase: SupabaseClient; refundRequestId: string }
): Promise<{ id: string | null; status: string }> {
    try {
        const refund = await stripeClient.refunds.create(
            { payment_intent: paymentIntent, amount: Math.round(Number(amount) * 100) },
            { idempotencyKey }
        );
        return { id: refund.id, status: refund.status || "succeeded" };
    } catch (err: unknown) {
        const stripeErr = err as { code?: string; type?: string; raw?: { refund?: { id?: string; status?: string } } };
        console.error(`Stripe refund error (${idempotencyKey}):`, err);
        if (stripeErr?.code === "charge_already_refunded") {
            // Refunded outside the app (e.g. Stripe dashboard): settle_stripe_refund needs that refund's id
            try {
                const { data } = await stripeClient.refunds.list({ payment_intent: paymentIntent, limit: 100 });
                let used = new Set<string>();
                if (ledger && data.length) {
                    const { data: rows, error } = await ledger.supabase
                        .from("refund_requests")
                        .select("stripe_refund_id")
                        .in("stripe_refund_id", data.map((r) => r.id))
                        .neq("id", ledger.refundRequestId);
                    if (error) throw error;
                    used = new Set((rows ?? []).map((r: { stripe_refund_id: string }) => r.stripe_refund_id));
                }
                const free = data.find((r) => !used.has(r.id));
                if (free) return { id: free.id, status: free.status || "succeeded" };
                // Every refund on the charge is already recorded: settle_stripe_refund sends this to admin review
                return { id: null, status: data.length ? "already_refunded" : "uncertain" };
            } catch (listErr) {
                console.error(`Stripe refund lookup error (${idempotencyKey}):`, listErr);
                return { id: null, status: "uncertain" };
            }
        }
        if (stripeErr?.raw?.refund) return { id: stripeErr.raw.refund.id || null, status: stripeErr.raw.refund.status || "failed" };
        if (stripeErr?.type === "StripeInvalidRequestError") return { id: null, status: "failed" };
        return { id: null, status: "uncertain" };
    }
}

export interface ProcessRefundJobResult {
    processed: number;
    succeeded: number;
    failed: number;
}

/**
 * Claims and processes pending Stripe refund requests from the ledger.
 */
export async function processPendingRefundJobs({
    workerId,
    leaseSeconds = 60,
    maxJobs = 10,
    supabase,
    stripeClient,
}: ProcessRefundJobsOptions): Promise<ProcessRefundJobResult> {
    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    for (let i = 0; i < maxJobs; i++) {
        const claimRes = await withDbRetry(() =>
            supabase.rpc("claim_pending_refund_request", {
                p_worker_id: workerId,
                p_lease_seconds: leaseSeconds,
            })
        );

        if (claimRes.error) {
            console.error("claim_pending_refund_request error:", claimRes.error);
            break;
        }

        const claimData = claimRes.data as {
            claimed?: boolean;
            found?: boolean;
            refund_request?: {
                id: string;
                payment_id: string;
                amount: number;
                currency: string;
                stripe_payment_intent: string;
                idempotency_key: string;
            };
        };

        const isClaimed = Boolean(claimData?.claimed ?? claimData?.found);
        if (!isClaimed || !claimData?.refund_request) {
            break; // No more jobs to claim
        }

        const job = claimData.refund_request;
        processed++;

        const { id: stripeRefundId, status: stripeRefundStatus } = await createStripeRefund(
            stripeClient || stripe,
            job.stripe_payment_intent,
            job.amount,
            job.idempotency_key,
            { supabase, refundRequestId: job.id }
        );

        const settleRes = await withDbRetry(() =>
            supabase.rpc("settle_stripe_refund", {
                p_refund_request_id: job.id,
                p_stripe_refund_id: stripeRefundId,
                p_stripe_status: stripeRefundStatus,
                p_stripe_payment_intent: job.stripe_payment_intent,
                p_amount: job.amount,
                p_currency: job.currency.toLowerCase(),
            })
        );

        if (settleRes.error) {
            console.error(`RefundWorker: settle_stripe_refund error for job ${job.id}:`, settleRes.error);
            failed++;
        } else if (stripeRefundStatus === "succeeded") {
            succeeded++;
        } else {
            failed++;
        }
    }

    return { processed, succeeded, failed };
}

/**
 * Stripe refund.updated / refund.failed: settles the ledger row that recorded this refund id. Closes the gap where a
 * refund stays pending at Stripe (e.g. a zero balance) longer than the worker re-checks it, then clears or fails.
 * "ignored" for non-final updates, refunds the app never made, and rows already refunded; "error" means retry.
 */
export async function settleRefundFromStripe(
    refund: { id: string; status?: string | null; payment_intent?: string | { id: string } | null },
    supabase: SupabaseClient
): Promise<"settled" | "ignored" | "error"> {
    const outcome = refund.status === "succeeded" ? "succeeded" : refund.status === "failed" || refund.status === "canceled" ? "failed" : null;
    if (!outcome) return "ignored";

    const { data: row, error } = await supabase
        .from("refund_requests")
        .select("id, amount, currency, status, stripe_payment_intent")
        .eq("stripe_refund_id", refund.id)
        .maybeSingle();
    if (error) {
        console.error(`Refund ${refund.id}: ledger lookup failed:`, error);
        return "error";
    }
    if (!row || row.status === "succeeded") return "ignored";

    const paymentIntent = row.stripe_payment_intent ?? (typeof refund.payment_intent === "string" ? refund.payment_intent : refund.payment_intent?.id) ?? null;
    const settleRes = await withDbRetry(() =>
        supabase.rpc("settle_stripe_refund", {
            p_refund_request_id: row.id,
            p_stripe_refund_id: refund.id,
            p_stripe_status: outcome,
            p_stripe_payment_intent: paymentIntent,
            p_amount: row.amount,
            p_currency: String(row.currency).toLowerCase(),
        })
    );
    if (settleRes.error) {
        console.error(`Refund ${refund.id}: settle_stripe_refund failed:`, settleRes.error);
        return "error";
    }
    return "settled";
}
