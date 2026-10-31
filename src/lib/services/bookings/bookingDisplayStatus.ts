interface HoldFields {
    status: string;
    created_at: string;
    hold_expires_at?: string | null;
    cancel_reason?: string | null;
}

// Same fallback as the database (hold_court_booking / cancel_expired_booking): created_at + 35 minutes
const HOLD_FALLBACK_MS = 35 * 60 * 1000;

/** GCash proof submitted: the database keeps the hold open forever (hold_expires_at = 'infinity') until staff decide. */
export const isAwaitingVerification = (booking: HoldFields) =>
    booking.status === "pending" && booking.hold_expires_at === "infinity";

/** True for an online hold whose checkout window is over, before or after cleanup has cancelled it. */
export const isHoldExpired = (booking: HoldFields, now: Date = new Date()) => {
    if (booking.status !== "pending") return false;
    const expiry = booking.hold_expires_at
        ? new Date(booking.hold_expires_at).getTime()
        : new Date(booking.created_at).getTime() + HOLD_FALLBACK_MS;
    return !Number.isNaN(expiry) && expiry <= now.getTime();
};

/** cancel_reason to record: a hold that had already timed out is 'expired' whoever cancels it. */
export const cancelReasonFor = (booking: HoldFields, cancelledBy: "admin" | "customer", now: Date = new Date()) =>
    isHoldExpired(booking, now) ? "expired" : cancelledBy;

/**
 * Status shown to staff and customers: "expired" for holds cleanup cancelled, "hold_expired" for pending holds whose
 * timer ran out but are not cleaned up yet; otherwise the stored status.
 */
export const getBookingDisplayStatus = (booking: HoldFields, now: Date = new Date()) => {
    if (booking.status === "cancelled" && booking.cancel_reason === "expired") return "expired";
    if (isAwaitingVerification(booking)) return "awaiting_verification";
    if (isHoldExpired(booking, now)) return "hold_expired";
    return booking.status;
};
