import { getBookingStart, getBookingEnd } from "../../utils/bookingTime.ts";

interface HoldFields {
    status: string;
    /** Only read for pending holds */
    created_at?: string;
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
        : new Date(booking.created_at ?? NaN).getTime() + HOLD_FALLBACK_MS;
    return !Number.isNaN(expiry) && expiry <= now.getTime();
};

/** cancel_reason to record: a hold that had already timed out is 'expired' whoever cancels it. */
export const cancelReasonFor = (booking: HoldFields, cancelledBy: "admin" | "customer", now: Date = new Date()) =>
    isHoldExpired(booking, now) ? "expired" : cancelledBy;

/**
 * What a cancelled booking's card tells the customer: who cancelled it (when the venue did) and where the money is.
 * `charged` is false when nothing was ever paid. Null for bookings that are not cancelled.
 */
export const cancellationNote = (booking: {
    status: string;
    cancel_reason?: string | null;
    payments?: { status: string; payment_method: string | null }[] | null;
    refund_status?: string | null;
}): { text: string; charged: boolean } | null => {
    if (booking.status !== "cancelled") return null;
    if (booking.cancel_reason === "gcash_rejected") return { text: "GCash payment could not be verified", charged: false };
    if (booking.cancel_reason === "payment_kept") return { text: "Cancelled by the venue · Payment kept under the venue's cancellation policy", charged: true };
    const payments = booking.payments ?? [];
    const outstanding = payments.find((p) => p.status === "paid");
    // A paid row on a cancelled booking is money still owed back: card refunds run automatically, cash/GCash at the counter
    const cardRefund =
        booking.refund_status === "failed" ? "Refund failed · The venue will contact you"
        : booking.refund_status === "requires_admin_review" ? "Refund delayed · The venue is checking it"
        : "Refund on its way to your card";
    const money = outstanding
        ? (outstanding.payment_method ?? "stripe") === "stripe" ? cardRefund : "The venue will refund you at the counter"
        : payments.some((p) => p.status === "refunded") ? "Refunded" : "Not charged";
    const text = booking.cancel_reason === "admin" ? `Cancelled by the venue · ${money}` : money;
    return { text, charged: money !== "Not charged" };
};

/**
 * Status shown to staff and customers: "expired" for holds cleanup cancelled, "hold_expired" for pending holds whose
 * timer ran out but are not cleaned up yet; otherwise the stored status.
 */
export const getBookingDisplayStatus = (
    booking: HoldFields & {
        booking_date?: string; start_time?: string; end_time?: string;
        court_id?: string | null; open_play_session_id?: string | null; open_play_spots?: number | null;
    },
    now: Date = new Date()
) => {
    if (booking.status === "cancelled" && booking.cancel_reason === "expired") return "expired";
    if (isAwaitingVerification(booking)) return "awaiting_verification";
    if (isHoldExpired(booking, now)) return "hold_expired";
    // An open play court block is never checked in (players are) and the cron skips it, so it follows the clock
    if (booking.status === "confirmed" && booking.open_play_session_id && booking.court_id && !booking.open_play_spots
        && booking.booking_date && booking.start_time && booking.end_time) {
        const slot = { booking_date: booking.booking_date, start_time: booking.start_time, end_time: booking.end_time };
        if (getBookingEnd(slot) <= now) return "completed";
        if (getBookingStart(slot) <= now) return "in_progress";
    }
    // A checked-in booking is in progress while its slot runs; nobody presses "start"
    if (booking.status === "checked_in" && booking.booking_date && booking.start_time && booking.end_time) {
        const slot = { booking_date: booking.booking_date, start_time: booking.start_time, end_time: booking.end_time };
        if (getBookingStart(slot) <= now && now < getBookingEnd(slot)) return "in_progress";
    }
    return booking.status;
};
