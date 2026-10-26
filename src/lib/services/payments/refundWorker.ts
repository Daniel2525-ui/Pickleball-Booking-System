import { SupabaseClient } from "@supabase/supabase-js";
import { stripe } from "../../stripe.ts";
import { withDbRetry } from "./withDbRetry.ts";

export interface ProcessRefundJobsOptions {
    workerId: string;
    leaseSeconds?: number;
    maxJobs?: number;
    supabase: SupabaseClient;
    stripeClient?: {
        refunds: {
            create: (
                params: { payment_intent: string },
                options?: { idempotencyKey?: string }
            ) => Promise<{ id: string; status?: string }>;
        };
    };
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

        let stripeRefundId: string | null = null;
        let stripeRefundStatus = "pending";

        try {
            const stripeInstance = stripeClient || stripe;
            const refund = await stripeInstance.refunds.create(
                {
                    payment_intent: job.stripe_payment_intent,
                },
                {
                    idempotencyKey: job.idempotency_key,
                }
            );
            stripeRefundId = refund.id;
            stripeRefundStatus = refund.status || "succeeded";
        } catch (err: unknown) {
            const stripeErr = err as {
                code?: string;
                type?: string;
                raw?: { refund?: { id?: string; status?: string } };
            };
            console.error(`RefundWorker: Stripe error for job ${job.id}:`, err);
            if (stripeErr?.code === "charge_already_refunded") {
                stripeRefundStatus = "succeeded";
            } else if (stripeErr?.raw?.refund) {
                stripeRefundId = stripeErr.raw.refund.id || null;
                stripeRefundStatus = stripeErr.raw.refund.status || "failed";
            } else if (stripeErr?.type === "StripeInvalidRequestError") {
                stripeRefundStatus = "failed";
            } else {
                stripeRefundStatus = "uncertain";
            }
        }

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
