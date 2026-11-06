import type { SupabaseClient } from "@supabase/supabase-js";
import { stripe } from "@/lib/stripe";
import { formatTime12h } from "@/lib/utils/formatTime";
import { paymentIdsMetadata } from "./reconcileCheckoutSession.ts";

export interface CheckoutLine {
    bookingId: string;
    paymentId: string;
    courtName: string;
    bookingDate: string;
    startTime: string;
    endTime: string;
    amount: number;
}

/**
 * Opens one Stripe Checkout for held courts (one line each) and ties every hold to it via
 * confirm_checkout_hold under the court lock. Metadata is what reconciliation trusts, so both
 * /api/stripe/checkout and /api/bookings/resume-payment build it here.
 * Stripe errors from sessions.create are thrown; a confirm failure expires the session and is returned.
 */
export async function openBasketCheckout({
    supabase,
    lines,
    basketId,
    customerEmail,
    baseUrl,
}: {
    supabase: SupabaseClient;
    lines: CheckoutLine[];
    basketId: string;
    customerEmail?: string;
    baseUrl: string;
}): Promise<{ url: string | null; confirmError: { message?: string } | null }> {
    const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        line_items: lines.map((l) => ({
            price_data: {
                currency: "php",
                product_data: {
                    name: `${l.courtName} — ${l.bookingDate} • ${formatTime12h(l.startTime)}–${formatTime12h(l.endTime)}`,
                },
                unit_amount: Math.round(l.amount * 100), // Stripe uses centavos
            },
            quantity: 1,
        })),
        mode: "payment",
        success_url: `${baseUrl}/book/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/book`,
        // Reconciliation confirms exactly these payments, never other rows of the basket
        metadata: { basket_id: basketId, ...paymentIdsMetadata(lines.map((l) => l.paymentId)) },
        customer_email: customerEmail,
        // Stripe needs expires_at at least 30 minutes out; 33 leaves 3 minutes for latency and clock skew
        expires_at: Math.floor(Date.now() / 1000) + 33 * 60,
    });

    // The hold outlives the session by 2 minutes so a late webhook still finds it held.
    // confirm_checkout_hold refuses a slot another player claimed meanwhile (no expired-hold resurrection).
    const holdExpiresAtIso = new Date((session.expires_at + 120) * 1000).toISOString();

    for (const l of lines) {
        const { error } = await supabase.rpc("confirm_checkout_hold", {
            p_booking_id: l.bookingId,
            p_payment_id: l.paymentId,
            p_stripe_session_id: session.id,
            p_hold_expires_at: holdExpiresAtIso,
        });
        if (error) {
            console.error("confirm_checkout_hold RPC failed:", error);
            try {
                await stripe.checkout.sessions.expire(session.id);
            } catch (expireErr) {
                console.error("Failed to expire superseded Stripe session:", expireErr);
            }
            return { url: null, confirmError: error };
        }
    }

    return { url: session.url, confirmError: null };
}
