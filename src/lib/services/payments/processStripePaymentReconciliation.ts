import { SupabaseClient } from "@supabase/supabase-js";
import { stripe } from "../../stripe.ts";
import { withDbRetry } from "./withDbRetry.ts";
import { createStripeRefund, type RefundStripeClient } from "./refundWorker.ts";

export interface ReconcileParams {
    bookingId: string;
    paymentId: string;
    amount: number;
    currency: string;
    stripeSessionId: string;
    stripePaymentIntent: string;
    supabase: SupabaseClient;
    stripeClient?: RefundStripeClient;
}

export interface ReconcileOutcome {
    success: boolean;
    action: "CONFIRMED" | "NO_OP" | "REFUND_SCHEDULED" | "ERROR";
    reason?: string;
    status?: string;
    refundRequestId?: string;
    refundStatus?: string;
    error?: string;
}

/**
 * Reconciles a completed Stripe Checkout session with the database.
 * Calls reconcile_booking_payment database RPC wrapped in withDbRetry,
 * handling normal confirmation, idempotency redelivery, or automatic refund scheduling.
 */
export async function processStripePaymentReconciliation(
    params: ReconcileParams
): Promise<ReconcileOutcome> {
    const {
        bookingId,
        paymentId,
        amount,
        currency,
        stripeSessionId,
        stripePaymentIntent,
        supabase,
        stripeClient,
    } = params;

    const rpcResult = await withDbRetry(() =>
        supabase.rpc("reconcile_booking_payment", {
            p_booking_id: bookingId,
            p_payment_id: paymentId,
            p_stripe_session_id: stripeSessionId,
            p_stripe_payment_intent: stripePaymentIntent,
            p_amount: amount,
            p_currency: currency.toLowerCase(),
        })
    );

    if (rpcResult.error) {
        console.error("reconcile_booking_payment RPC error:", rpcResult.error);
        return {
            success: false,
            action: "ERROR",
            error: rpcResult.error.message || "Database reconciliation failed",
        };
    }

    const data = rpcResult.data as {
        action: "CONFIRMED" | "NO_OP" | "REFUND_SCHEDULED";
        status?: string;
        reason?: string;
        idempotency_key?: string;
        refund_request_id?: string;
        payment_id?: string;
    };

    if (!data) {
        return {
            success: false,
            action: "ERROR",
            error: "Empty reconciliation response",
        };
    }

    if (data.action === "CONFIRMED") {
        return {
            success: true,
            action: "CONFIRMED",
            status: data.status,
        };
    }

    if (data.action === "NO_OP") {
        return {
            success: true,
            action: "NO_OP",
            status: data.status,
        };
    }

    if (data.action === "REFUND_SCHEDULED") {
        let stripeRefundId: string | null = null;
        let stripeRefundStatus = "pending";

        if (stripePaymentIntent && data.idempotency_key) {
            ({ id: stripeRefundId, status: stripeRefundStatus } = await createStripeRefund(
                stripeClient || stripe,
                stripePaymentIntent,
                amount,
                data.idempotency_key,
                data.refund_request_id ? { supabase, refundRequestId: data.refund_request_id } : undefined
            ));
        }

        if (data.refund_request_id) {
            const settleRes = await withDbRetry(() =>
                supabase.rpc("settle_stripe_refund", {
                    p_refund_request_id: data.refund_request_id,
                    p_stripe_refund_id: stripeRefundId,
                    p_stripe_status: stripeRefundStatus,
                    p_stripe_payment_intent: stripePaymentIntent,
                    p_amount: amount,
                    p_currency: currency.toLowerCase(),
                })
            );

            if (settleRes.error) {
                console.error("settle_stripe_refund RPC error:", settleRes.error);
                return {
                    success: false,
                    action: "REFUND_SCHEDULED",
                    error: settleRes.error.message || "Failed to settle refund in database",
                    refundRequestId: data.refund_request_id,
                    refundStatus: stripeRefundStatus,
                };
            }
        }

        return {
            success: true,
            action: "REFUND_SCHEDULED",
            reason: data.reason,
            refundRequestId: data.refund_request_id,
            refundStatus: stripeRefundStatus,
        };
    }

    return {
        success: true,
        action: data.action,
        status: data.status,
    };
}
