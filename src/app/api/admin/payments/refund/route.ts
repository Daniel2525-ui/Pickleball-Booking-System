import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import { requireAdmin } from "@/lib/supabase/server";
import { processPendingRefundJobs } from "@/lib/services/payments/refundWorker.ts";

/**
 * Admin refund for a paid payment whose booking was cancelled.
 *
 * - Stripe: reserves a full refund in the ledger (reserve_payment_refund) and runs the existing
 *   refund worker immediately; anything it cannot finish is retried by the cron job.
 * - Cash / GCash: staff hand the money back, then this records the handover receipt
 *   (request_manual_cash_refund + confirm_manual_cash_refund).
 * Full refunds only, enforced by the database. Idempotent per payment.
 */
export async function POST(request: NextRequest) {
    try {
        const { supabase, denied } = await requireAdmin();
        if (denied) return denied;

        const body = await request.json().catch(() => null);
        const paymentId = typeof body?.paymentId === "string" ? body.paymentId.trim() : "";
        const receiptReference = typeof body?.receiptReference === "string" ? body.receiptReference.trim() : "";

        if (!paymentId) {
            return NextResponse.json({ error: "paymentId is required." }, { status: 400 });
        }

        const { data: payment, error: paymentError } = await supabase
            .from("payments")
            .select("id, booking_id, amount, currency, status, payment_method, stripe_payment_id, bookings ( status, cancel_reason )")
            .eq("id", paymentId)
            .maybeSingle();

        if (paymentError) {
            console.error("Refund: failed to load payment:", paymentError);
            return NextResponse.json({ error: "Could not load the payment." }, { status: 500 });
        }
        if (!payment) {
            return NextResponse.json({ error: "Payment not found." }, { status: 404 });
        }

        const linked = ([] as { status: string; cancel_reason: string | null }[]).concat(payment.bookings ?? [])[0];
        const bookingStatus = linked?.status;
        if (linked?.cancel_reason === "payment_kept") {
            return NextResponse.json({ error: "This payment was kept when the booking was cancelled, so it is not owed back." }, { status: 409 });
        }
        if (payment.status !== "paid") {
            return NextResponse.json({ error: "Only paid payments can be refunded." }, { status: 409 });
        }
        if (bookingStatus !== "cancelled") {
            return NextResponse.json({ error: "Cancel the booking before refunding its payment." }, { status: 409 });
        }

        const method = (payment.payment_method || "stripe").toLowerCase();
        const idempotencyKey = `ref_admin_${payment.id}`;
        const reason = "ADMIN_REFUND_CANCELLED_BOOKING";

        if (method === "cash" || method === "gcash") {
            if (!receiptReference) {
                return NextResponse.json(
                    { error: "Enter the receipt or GCash reference for the money handed back." },
                    { status: 400 }
                );
            }

            const { data: requested, error: requestError } = await supabase.rpc("request_manual_cash_refund", {
                p_payment_id: payment.id,
                p_booking_id: payment.booking_id,
                p_amount: payment.amount,
                p_currency: payment.currency,
                p_reason: reason,
                p_idempotency_key: idempotencyKey,
            });

            if (requestError || !requested?.refund_request_id) {
                console.error("Refund: request_manual_cash_refund failed:", requestError);
                return NextResponse.json({ error: "Could not record the refund. Please try again." }, { status: 500 });
            }

            const { error: confirmError } = await supabase.rpc("confirm_manual_cash_refund", {
                p_refund_request_id: requested.refund_request_id,
                p_receipt_reference: receiptReference,
                p_notes: null,
            });

            if (confirmError) {
                console.error("Refund: confirm_manual_cash_refund failed:", confirmError);
                return NextResponse.json({ error: "Could not record the refund handover. Please try again." }, { status: 500 });
            }

            return NextResponse.json({ status: "refunded" });
        }

        if (method !== "stripe" || !payment.stripe_payment_id) {
            return NextResponse.json({ error: "This payment cannot be refunded automatically." }, { status: 409 });
        }

        const { error: reserveError } = await supabase.rpc("reserve_payment_refund", {
            p_payment_id: payment.id,
            p_booking_id: payment.booking_id,
            p_amount: payment.amount,
            p_currency: payment.currency,
            p_payment_method: "stripe",
            p_reason: reason,
            p_idempotency_key: idempotencyKey,
            p_stripe_payment_intent: payment.stripe_payment_id,
        });

        if (reserveError) {
            console.error("Refund: reserve_payment_refund failed:", reserveError);
            // An earlier refund (e.g. the customer's own cancel) is still pending or awaiting review
            if (reserveError.message?.includes("REFUND_CAP_EXCEEDED")) {
                return NextResponse.json(
                    { error: "A card refund for this payment is already in progress. Check its status in the Stripe dashboard." },
                    { status: 409 }
                );
            }
            return NextResponse.json({ error: "Could not queue the refund. Please try again." }, { status: 500 });
        }

        // Run the worker now so staff see the result; the cron job retries anything left over.
        const serviceClient = getServiceClient();
        if (!serviceClient) {
            return NextResponse.json({ status: "queued" });
        }

        await processPendingRefundJobs({ workerId: "admin-refund", maxJobs: 5, supabase: serviceClient }).catch((err: unknown) => {
            console.error("Refund: inline refund worker failed:", err);
        });

        const { data: after } = await serviceClient.from("payments").select("status").eq("id", payment.id).maybeSingle();
        return NextResponse.json({ status: after?.status === "refunded" ? "refunded" : "queued" });
    } catch (error) {
        console.error("Refund route error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
