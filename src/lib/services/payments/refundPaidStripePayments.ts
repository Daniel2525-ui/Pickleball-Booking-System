import type { SupabaseClient } from "@supabase/supabase-js";
import { processPendingRefundJobs } from "./refundWorker.ts";

type RefundOutcome = "refunded" | "queued" | "manual" | null;

/**
 * Queues a full refund for each paid Stripe payment on the (already cancelled) booking and runs the
 * refund worker inline; the cron job retries anything left. Cash/GCash payments are left for staff
 * ("Refund Owed" in the admin). Never throws: the cancellation has already succeeded.
 */
export async function refundPaidStripePayments(
    admin: SupabaseClient,
    bookingId: string,
    opts: { reason: string; keyPrefix: string }
): Promise<RefundOutcome> {
    try {
        const { data: payments, error } = await admin
            .from("payments")
            .select("id, booking_id, amount, currency, payment_method, stripe_payment_id")
            .eq("booking_id", bookingId)
            .eq("status", "paid");
        if (error) throw error;
        if (!payments?.length) return null;

        let outcome: RefundOutcome = null;
        for (const payment of payments) {
            const method = (payment.payment_method || "stripe").toLowerCase();
            if (method !== "stripe" || !payment.stripe_payment_id) {
                outcome = "manual";
                continue;
            }
            const { error: reserveError } = await admin.rpc("reserve_payment_refund", {
                p_payment_id: payment.id,
                p_booking_id: payment.booking_id,
                p_amount: payment.amount,
                p_currency: payment.currency,
                p_payment_method: "stripe",
                p_reason: opts.reason,
                p_idempotency_key: `${opts.keyPrefix}${payment.id}`,
                p_stripe_payment_intent: payment.stripe_payment_id,
            });
            if (reserveError) {
                console.error("Cancel booking: reserve_payment_refund failed:", reserveError);
                outcome = "manual";
            } else if (outcome !== "manual") {
                outcome = "queued";
            }
        }

        if (outcome === "queued") {
            await processPendingRefundJobs({ workerId: "customer-cancel", maxJobs: 5, supabase: admin });
            const { data: after } = await admin.from("payments").select("status").eq("booking_id", bookingId).eq("status", "paid");
            if (!after?.length) outcome = "refunded";
        }
        return outcome;
    } catch (err) {
        console.error("Cancel booking: refund failed; left for staff:", err);
        return "manual";
    }
}
