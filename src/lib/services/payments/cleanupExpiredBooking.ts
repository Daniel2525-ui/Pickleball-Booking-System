import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { stripe as defaultStripe } from "../../stripe.ts";
import { reconcileCheckoutSession } from "./reconcileCheckoutSession.ts";

export interface ExpiredBooking {
    id: string;
    payments: { id: string; status: string; stripe_session_id: string | null; paid_at: string | null }[] | null;
}

export interface CleanupDeps {
    supabase: SupabaseClient;
    stripeClient?: { checkout: { sessions: Pick<Stripe["checkout"]["sessions"], "retrieve" | "expire"> } };
    reconcile?: (session: Stripe.Checkout.Session, supabase: SupabaseClient) => Promise<{ error: string | null }>;
    /** Sessions already reconciled this run: a basket shares one session across its courts */
    reconciledSessions?: Set<string>;
}

export type CleanupResult = "cancelled" | "reconciled" | "skipped";

/**
 * One expired hold: never cancel while Stripe is uncertain or paid; a paid session is reconciled,
 * open sessions are expired first, then cancel_expired_booking cancels under row locks.
 */
export async function cleanupExpiredBooking(
    booking: ExpiredBooking,
    { supabase, stripeClient = defaultStripe, reconcile = reconcileCheckoutSession, reconciledSessions = new Set() }: CleanupDeps
): Promise<CleanupResult> {
    const payments = booking.payments ?? [];

    if (payments.some((p) => ["paid", "succeeded", "refunded"].includes(p.status?.toLowerCase()) || Boolean(p.paid_at))) {
        console.warn(`Booking ${booking.id} has settled payment; skipping cancellation.`);
        return "skipped";
    }

    let paidSession: Stripe.Checkout.Session | null = null;
    const openSessions: string[] = [];

    for (const payment of payments) {
        if (!payment.stripe_session_id) continue;

        let session: Stripe.Checkout.Session;
        try {
            session = await stripeClient.checkout.sessions.retrieve(payment.stripe_session_id);
        } catch (err) {
            // An API error never means unpaid
            console.error(`Uncertain Stripe state for payment ${payment.id} on booking ${booking.id}:`, (err as Error).message);
            return "skipped";
        }

        if (session.payment_status === "paid") {
            paidSession ??= session;
        } else if (session.status === "open") {
            openSessions.push(session.id);
        } else if (session.status !== "expired") {
            // complete-but-unpaid (async method may still settle) or an unknown status
            console.warn(`Booking ${booking.id} has session ${session.id} in status '${session.status}/${session.payment_status}'; treating as uncertain.`);
            return "skipped";
        }
    }

    if (paidSession) {
        for (const id of openSessions) {
            try {
                await stripeClient.checkout.sessions.expire(id);
            } catch (err) {
                console.warn(`Could not expire redundant open session ${id}:`, (err as Error).message);
            }
        }
        if (reconciledSessions.has(paidSession.id)) return "skipped";
        const outcome = await reconcile(paidSession, supabase);
        if (outcome.error) {
            console.error(`Reconciliation failed for paid session ${paidSession.id} on booking ${booking.id}:`, outcome.error);
            return "skipped";
        }
        reconciledSessions.add(paidSession.id);
        return "reconciled";
    }

    for (const id of openSessions) {
        try {
            await stripeClient.checkout.sessions.expire(id);
        } catch (err) {
            console.error(`Failed to expire Stripe session ${id}:`, (err as Error).message);
            return "skipped";
        }
    }

    const pendingPayment = payments.find((p) => p.status === "pending");
    const { data, error } = await supabase.rpc("cancel_expired_booking", {
        p_booking_id: booking.id,
        p_payment_id: pendingPayment?.id ?? null,
    });

    if (error) {
        console.error(`cancel_expired_booking RPC failed for ${booking.id}:`, error);
        return "skipped";
    }
    if (!data?.cancelled) {
        console.log(`Booking ${booking.id} was not cancelled:`, data?.reason);
        return "skipped";
    }
    return "cancelled";
}
