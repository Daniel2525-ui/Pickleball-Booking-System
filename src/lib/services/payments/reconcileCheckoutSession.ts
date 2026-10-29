import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { processStripePaymentReconciliation } from "./processStripePaymentReconciliation.ts";

type SessionRow = { booking_id: string; payment_id: string; amount: number; currency: string; status: string };
type Metadata = Record<string, string | undefined>;

/** Basket metadata -> every loaded basket row; legacy metadata (booking_id + payment_id) -> that one row. */
export function checkoutTargets(metadata: Metadata, rows: SessionRow[]) {
    const picked = metadata.basket_id
        ? rows
        : rows.filter((r) => r.booking_id === metadata.booking_id && r.payment_id === metadata.payment_id);
    return picked.map((r) => ({ bookingId: r.booking_id, paymentId: r.payment_id, amount: Number(r.amount), currency: r.currency }));
}

// Ids come only from server-retrieved Stripe metadata; a basket row tied to another session (e.g. a later duplicate payment) is skipped
async function loadSessionRows(session: Stripe.Checkout.Session, supabase: SupabaseClient) {
    const m: Metadata = session.metadata ?? {};
    const query = supabase
        .from("payments")
        .select("payment_id:id, booking_id, amount, currency, status, bookings!inner(basket_id)");
    const { data, error } = await (m.basket_id
        ? query.eq("bookings.basket_id", m.basket_id).or(`stripe_session_id.is.null,stripe_session_id.eq.${session.id}`)
        : query.eq("id", m.payment_id ?? "").eq("booking_id", m.booking_id ?? ""));
    return { rows: (data ?? []) as unknown as SessionRow[], error };
}

const hasMetadata = (m: Metadata) => Boolean(m.basket_id || (m.booking_id && m.payment_id));

export async function reconcileCheckoutSession(session: Stripe.Checkout.Session, supabase: SupabaseClient) {
    const confirmed: string[] = [];
    const refunded: { bookingId: string; reason: string }[] = [];
    const paymentIntent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || "";
    if (!paymentIntent) return { confirmed, refunded, error: `Missing payment_intent in session ${session.id}` };
    if (!hasMetadata(session.metadata ?? {})) return { confirmed, refunded, error: `Missing metadata in session ${session.id}` };

    const { rows, error } = await loadSessionRows(session, supabase);
    if (error) return { confirmed, refunded, error: error.message || "Failed to load checkout rows" };
    const targets = checkoutTargets(session.metadata ?? {}, rows);
    if (targets.length === 0) return { confirmed, refunded, error: `No payment rows for checkout session ${session.id}` };

    const errors: string[] = [];
    // Each court is reconciled on its own; one failing court must not stop the others
    for (const t of targets) {
        const outcome = await processStripePaymentReconciliation({
            ...t,
            stripeSessionId: session.id,
            stripePaymentIntent: paymentIntent,
            supabase,
        });
        if (!outcome.success) errors.push(`booking ${t.bookingId}: ${outcome.error}`);
        else if (outcome.action === "CONFIRMED") confirmed.push(t.bookingId);
        else if (outcome.action === "REFUND_SCHEDULED") refunded.push({ bookingId: t.bookingId, reason: outcome.reason ?? "REFUND" });
    }
    return { confirmed, refunded, error: errors.length ? errors.join("; ") : null };
}

/** checkout.session.expired: release every pending court of the basket, or the legacy booking. */
export async function expireCheckoutSession(session: Stripe.Checkout.Session, supabase: SupabaseClient): Promise<void> {
    const m: Metadata = session.metadata ?? {};
    let targets: { bookingId: string; paymentId: string }[] = [];
    if (m.basket_id) {
        const { rows, error } = await loadSessionRows(session, supabase);
        if (error) {
            console.error(`Expired session ${session.id}: failed to load basket rows:`, error);
            return;
        }
        targets = checkoutTargets(m, rows.filter((r) => r.status === "pending"));
    } else if (m.booking_id && m.payment_id) {
        targets = [{ bookingId: m.booking_id, paymentId: m.payment_id }];
    }

    for (const t of targets) {
        const cancelRes = await supabase.rpc("cancel_expired_booking", {
            p_booking_id: t.bookingId,
            p_payment_id: t.paymentId,
        });
        console.log(`Checkout session expired cleanup for booking ${t.bookingId}:`, cancelRes.data ?? cancelRes.error);
    }
}
