/** One row of public.booking_events, with the actor's name (written by triggers on bookings and payments). */
export interface BookingEvent {
    id: number;
    action: string;
    detail: string | null;
    actor_id: string | null;
    created_at: string;
    profiles?: { full_name: string | null } | null;
}

const METHOD: Record<string, string> = { cash: "Cash", gcash: "GCash", stripe: "Card" };
const REASON: Record<string, string> = {
    expired: "hold expired",
    gcash_rejected: "GCash payment rejected",
    checkout_failed: "checkout failed",
    slot_conflict: "slot was taken",
    court_unavailable: "court unavailable",
    start_passed: "start time passed",
    payment_kept: "payment kept",
};
const CREATED: Record<string, string> = { pending: "Booked online, awaiting payment", completed: "Recorded as played" };
const ACTION: Record<string, string> = {
    confirmed: "Confirmed",
    checked_in: "Checked in",
    started: "Started",
    completed: "Marked played",
    no_show: "Marked no-show",
    cancelled: "Cancelled",
    moved: "Moved",
    paid: "Payment recorded",
    refunded: "Refunded",
};

// "cash · ref 7741 · 200.00" → "Cash · ref 7741 · ₱200"
const money = (detail: string) => {
    const parts = detail.split(" · ");
    const amount = Number(parts.at(-1));
    const method = METHOD[parts[0]] ?? parts[0];
    return [method, ...parts.slice(1, -1), Number.isFinite(amount) ? `₱${amount.toLocaleString("en-PH")}` : parts.at(-1)].join(" · ");
};

/** What happened, who did it, and any detail, in staff wording. */
export function describeEvent(e: BookingEvent, bookingUserId: string | null | undefined) {
    const who = !e.actor_id ? "System" : e.actor_id === bookingUserId ? "the player" : e.profiles?.full_name?.trim() || "Staff";
    const what = e.action === "created" ? CREATED[e.detail ?? ""] ?? "Booked" : ACTION[e.action] ?? "Status changed";
    let detail: string | null = null;
    if (e.action === "cancelled" && e.detail) {
        const [reason, note] = e.detail.split("|"); // "payment_kept|Late cancellation"
        detail = [REASON[reason], note].filter(Boolean).join(": ") || null;
    }
    else if (e.action === "moved") detail = e.detail;
    else if ((e.action === "paid" || e.action === "refunded") && e.detail) detail = money(e.detail);
    return { what, who, detail };
}
