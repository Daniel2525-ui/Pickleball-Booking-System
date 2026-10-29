import type { SupabaseClient } from "@supabase/supabase-js";
import type { Booking } from "./bookingsTypes";

/** An unpaid basket acts as one unit: its pending bookings sharing coalesce(basket_id, id). */
export interface BasketSibling {
    id: string;
    user_id: string | null;
    court_id: string;
    booking_date: string;
    start_time: string;
    end_time: string;
    status: string;
    total_amount: number | null;
    hold_expires_at: string | null;
    created_at: string;
    basket_id: string | null;
    courts: { name?: string } | null;
    payments: { id: string; status: string; stripe_session_id: string | null; amount: number | string | null }[];
}

/** Pending siblings of a booking (itself included while pending), court order for a stable lock order. */
export async function loadPendingSiblings(
    client: SupabaseClient,
    booking: { id: string; basket_id?: string | null },
    userId?: string
) {
    let query = client
        .from("bookings")
        .select("id, user_id, court_id, booking_date, start_time, end_time, status, total_amount, hold_expires_at, created_at, basket_id, courts(name), payments(id, status, stripe_session_id, amount)")
        .eq("status", "pending")
        .order("court_id")
        // A later duplicate-charge payment row can exist (20261102); the original comes first
        .order("created_at", { referencedTable: "payments", ascending: true });
    query = booking.basket_id ? query.eq("basket_id", booking.basket_id) : query.eq("id", booking.id);
    if (userId) query = query.eq("user_id", userId);
    const { data, error } = await query;
    return { siblings: (data ?? []) as unknown as BasketSibling[], error };
}

/** Distinct Stripe sessions of the siblings' original payments (one for a basket). */
export const siblingSessionIds = (siblings: Pick<BasketSibling, "payments">[]) => [
    ...new Set(siblings.map((s) => s.payments[0]?.stripe_session_id).filter((id): id is string => Boolean(id))),
];

/** Pending payment ids of the given siblings. */
export const pendingPaymentIds = (siblings: Pick<BasketSibling, "payments">[]) =>
    siblings.flatMap((s) => s.payments.filter((p) => p.status === "pending").map((p) => p.id));

const firstPayment = (b: Booking) => (Array.isArray(b.payments) ? b.payments[0] : b.payments) ?? null;

/**
 * What a counter settlement of `booking` collects, from the already-loaded list: every pending court of its
 * basket with a pending payment, or the booking alone when it is not an unpaid basket.
 */
export function counterSettlementDue(booking: Booking, loaded: Booking[]) {
    const alone = { ids: [booking.id], total: Number(booking.total_amount) || 0 };
    if (!booking.basket_id || booking.status !== "pending") return alone;
    const rows = loaded.filter(
        (b) => b.basket_id === booking.basket_id && b.status === "pending" && firstPayment(b)?.status === "pending"
    );
    if (!rows.some((b) => b.id === booking.id)) return alone;
    return {
        ids: rows.map((b) => b.id),
        total: rows.reduce((sum, b) => sum + (Number(firstPayment(b)?.amount ?? b.total_amount) || 0), 0),
    };
}

/** Money equality to the centavo (amounts arrive as numbers or numeric strings). */
export const sameCentavo = (a: number | string, b: number | string) =>
    Math.round(Number(a) * 100) === Math.round(Number(b) * 100);
