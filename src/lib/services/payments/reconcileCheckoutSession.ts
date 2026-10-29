import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { processStripePaymentReconciliation } from "./processStripePaymentReconciliation.ts";

type SessionRow = { booking_id: string; payment_id: string; amount: number; currency: string; status: string };
type Metadata = Record<string, string | undefined>;

// Stripe metadata values are capped at 500 characters; 13 uuids (36 chars + comma) fit
export const MAX_SESSION_PAYMENTS = 13;
const paymentIds = (m: Metadata) => (m.payment_ids ?? "").split(",").filter(Boolean);

/** Basket metadata -> exactly the rows named in payment_ids; legacy metadata (booking_id + payment_id) -> that one row. */
export function checkoutTargets(metadata: Metadata, rows: SessionRow[]) {
    const ids = paymentIds(metadata);
    const picked = metadata.basket_id
        ? rows.filter((r) => ids.includes(r.payment_id))
        : rows.filter((r) => r.booking_id === metadata.booking_id && r.payment_id === metadata.payment_id);
    return picked.map((r) => ({ bookingId: r.booking_id, paymentId: r.payment_id, amount: Number(r.amount), currency: r.currency }));
}

// Ids come only from server-retrieved Stripe metadata: exactly the payments the session charged, never other basket rows
async function loadSessionRows(session: Stripe.Checkout.Session, supabase: SupabaseClient) {
    const m: Metadata = session.metadata ?? {};
    const query = supabase
        .from("payments")
        .select("payment_id:id, booking_id, amount, currency, status, bookings!inner(basket_id)");
    const { data, error } = await (m.basket_id
        ? query.eq("bookings.basket_id", m.basket_id).in("id", paymentIds(m))
        : query.eq("id", m.payment_id ?? "").eq("booking_id", m.booking_id ?? ""));
    return { rows: (data ?? []) as unknown as SessionRow[], error };
}

// A basket session without payment_ids is refused rather than guessed at
const hasMetadata = (m: Metadata) => (m.basket_id ? paymentIds(m).length > 0 : Boolean(m.booking_id && m.payment_id));

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

    // Backstop: the rows must add up to exactly what Stripe charged, or nothing is reconciled
    const centavos = targets.reduce((sum, t) => sum + Math.round(t.amount * 100), 0);
    const currency = (session.currency ?? "").toLowerCase();
    if (centavos !== session.amount_total || targets.some((t) => t.currency.toLowerCase() !== currency)) {
        return { confirmed, refunded, error: `Session ${session.id} charged ${session.amount_total} ${currency}, rows total ${centavos}: not reconciled` };
    }

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
