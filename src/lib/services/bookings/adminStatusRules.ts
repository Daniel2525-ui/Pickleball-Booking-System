// Relative import so node:test can load this module without the @/ alias
import { getBookingStart, getBookingEnd, formatManilaDate } from "../../utils/bookingTime.ts";
import { cancelReasonFor } from "./bookingDisplayStatus.ts";

/**
 * Valid transitions staff may trigger from /api/admin/bookings/status.
 * Staff only check in; "in progress" is shown from the clock and the cron closes bookings at their end (autoCloseStatus).
 * in_progress stays as a source for rows written before that change.
 */
export const ALLOWED_TRANSITIONS: Record<string, string[]> = {
    pending: ["cancelled"],
    confirmed: ["checked_in", "no_show", "cancelled"],
    checked_in: ["cancelled"],
    in_progress: ["completed", "cancelled"],
    no_show: ["completed"], // "Mark as Played": staff forgot to check the group in
};

/** Status the cron moves a court booking to once its slot has ended, or null to leave it alone. */
export const autoCloseStatus = (
    booking: { status: string; booking_date: string; start_time: string; end_time: string },
    now: Date = new Date()
) => {
    if (getBookingEnd(booking) > now) return null;
    if (booking.status === "checked_in" || booking.status === "in_progress") return "completed";
    if (booking.status === "confirmed") return "no_show";
    return null;
};

export const NO_SHOW_GRACE_MINUTES = 15;

export const canTransition = (currentStatus: string, newStatus: string) =>
    (ALLOWED_TRANSITIONS[currentStatus.toLowerCase()] ?? []).includes(newStatus.toLowerCase());

/**
 * Why a game-day status can't be set yet (venue time), or null when it can.
 * Check-in and start only on the booking's day; completed also allowed later, to close a missed booking.
 */
export const gameDayBlockReason = (newStatus: string, booking: { booking_date: string }, now: Date = new Date()) => {
    const today = formatManilaDate(now); // YYYY-MM-DD, so string comparison orders dates
    if ((newStatus === "checked_in" || newStatus === "in_progress") && booking.booking_date !== today)
        return "Players can only be checked in or started on the day of their booking.";
    if (newStatus === "completed" && booking.booking_date > today)
        return "A booking can't be completed before its date.";
    return null;
};

/** Minutes left before a no-show may be recorded (0 once the grace period after start has passed). */
export const noShowMinutesLeft = (booking: { booking_date: string; start_time: string }, now: Date = new Date()) => {
    const graceCutoff = getBookingStart(booking).getTime() + NO_SHOW_GRACE_MINUTES * 60_000;
    return Math.max(0, Math.ceil((graceCutoff - now.getTime()) / 60_000));
};

/** Status update plus the audit timestamp that goes with it. */
export const buildStatusUpdate = (
    newStatus: string,
    booking?: Parameters<typeof cancelReasonFor>[0],
    now: Date = new Date()
) => {
    const at = now.toISOString();
    const update: Record<string, unknown> = { status: newStatus };
    if (newStatus === "checked_in") update.checked_in_at = at;
    if (newStatus === "in_progress") update.started_at = at;
    if (newStatus === "completed") update.completed_at = at;
    if (newStatus === "no_show") update.no_show_at = at;
    if (newStatus === "cancelled") update.cancel_reason = booking ? cancelReasonFor(booking, "admin", now) : "admin";
    return update;
};
