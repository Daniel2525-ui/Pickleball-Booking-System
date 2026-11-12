import type { SupabaseClient } from "@supabase/supabase-js";
import { paymentIdsMetadata } from "./reconcileCheckoutSession.ts";
import { qrExpiresAt, xendit, xenditEnabled, type XenditPaymentRequest } from "@/lib/xendit";

export interface CheckoutLine {
    bookingId: string;
    paymentId: string;
    courtName: string;
    bookingDate: string;
    startTime: string;
    endTime: string;
    amount: number;
}

/** Thrown before anything is created when the QR Ph keys are missing, so callers can release the holds. */
export const QR_PH_NOT_CONFIGURED = "QR Ph is not configured";

/**
 * Opens one QR Ph payment (Xendit) for held courts and ties every hold to it via confirm_checkout_hold under
 * the court lock. QR Ph is the only online payment method. Metadata is what reconciliation trusts, so
 * /api/stripe/checkout, /api/bookings/resume-payment and open play all build it here.
 * Xendit errors are thrown; a confirm failure is returned.
 */
export async function openBasketCheckout({
    supabase,
    lines,
    basketId,
}: {
    supabase: SupabaseClient;
    lines: CheckoutLine[];
    basketId: string;
    /** Kept for callers; QR Ph needs neither */
    customerEmail?: string;
    baseUrl?: string;
}): Promise<{ url: string | null; confirmError: { message?: string } | null }> {
    if (!xenditEnabled()) throw new Error(QR_PH_NOT_CONFIGURED);
    return openXenditQr({ supabase, lines, basketId });
}

// A Xendit QR Ph payment request; its id fills the stripe_session_id column the reconciliation code reads
async function openXenditQr({ supabase, lines, basketId }: { supabase: SupabaseClient; lines: CheckoutLine[]; basketId: string }) {
    const pr = await xendit<XenditPaymentRequest>("/v3/payment_requests", {
        reference_id: basketId,
        type: "PAY",
        country: "PH",
        currency: "PHP",
        request_amount: lines.reduce((sum, l) => sum + l.amount, 0),
        capture_method: "AUTOMATIC",
        channel_code: "QRPH",
        description: `Court booking ${lines[0]?.bookingDate ?? ""}`,
        metadata: { basket_id: basketId, ...paymentIdsMetadata(lines.map((l) => l.paymentId)) },
    });
    // The hold ends exactly when the QR does: 15 minutes
    const holdExpiresAtIso = new Date(qrExpiresAt(pr)).toISOString();
    for (const l of lines) {
        const { error } = await supabase.rpc("confirm_checkout_hold", {
            p_booking_id: l.bookingId,
            p_payment_id: l.paymentId,
            p_stripe_session_id: pr.payment_request_id,
            p_hold_expires_at: holdExpiresAtIso,
        });
        if (error) return { url: null, confirmError: error };
    }
    return { url: `/book/qr?pr=${encodeURIComponent(pr.payment_request_id)}`, confirmError: null };
}
