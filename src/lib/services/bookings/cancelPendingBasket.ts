import type { SupabaseClient } from "@supabase/supabase-js";
import { stripe } from "@/lib/stripe";
import { type BasketSibling, pendingPaymentIds, siblingSessionIds } from "./basketSiblings";

// Server only: kept out of basketSiblings.ts, which the admin bookings table imports in the browser

/**
 * Closes the open Checkout of an unpaid basket so nobody pays for a cancelled booking.
 * "paid" when a session already completed (the webhook will confirm it); throws when Stripe fails.
 */
export async function closeSiblingSessions(siblings: Pick<BasketSibling, "payments">[]): Promise<"closed" | "paid"> {
    for (const sessionId of siblingSessionIds(siblings)) {
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        if (session.status === "complete") return "paid";
        if (session.status === "open") await stripe.checkout.sessions.expire(sessionId);
    }
    return "closed";
}

/**
 * After `clickedId` was cancelled: cancels the rest of its unpaid basket (a court changed meanwhile is
 * left alone) and marks the cancelled courts' pending payments failed. Errors are logged, never thrown.
 */
export async function cancelRestOfBasket(
    client: SupabaseClient,
    clickedId: string,
    siblings: BasketSibling[],
    updateFor: (sibling: BasketSibling) => Record<string, unknown>,
    userId?: string
) {
    const cancelled = siblings.filter((s) => s.id === clickedId);
    for (const sibling of siblings.filter((s) => s.id !== clickedId)) {
        let query = client.from("bookings").update(updateFor(sibling)).eq("id", sibling.id).eq("status", "pending");
        if (userId) query = query.eq("user_id", userId);
        const { data: done, error } = await query.select("id").maybeSingle();
        if (error) console.error(`Failed to cancel basket court ${sibling.id}:`, error);
        else if (done) cancelled.push(sibling);
    }

    // payments.status check constraint: pending, paid, failed, refunded
    const failedPaymentIds = pendingPaymentIds(cancelled);
    if (failedPaymentIds.length) {
        const { error } = await client.from("payments").update({ status: "failed" }).in("id", failedPaymentIds).eq("status", "pending");
        // The bookings are cancelled; log so the payment rows can be reconciled
        if (error) console.error("Failed to mark basket payments failed:", error);
    }
}
