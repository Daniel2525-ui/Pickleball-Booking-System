// Relative import so node:test can load this module without the @/ alias
import { getBookingStart } from "../../utils/bookingTime.ts";

/** Valid transitions staff may trigger from /api/admin/bookings/status. */
export const ALLOWED_TRANSITIONS: Record<string, string[]> = {
    pending: ["cancelled"],
    confirmed: ["checked_in", "no_show", "completed", "cancelled"],
    checked_in: ["in_progress", "completed", "cancelled"],
    in_progress: ["completed", "cancelled"],
};

export const NO_SHOW_GRACE_MINUTES = 15;

export const canTransition = (currentStatus: string, newStatus: string) =>
    (ALLOWED_TRANSITIONS[currentStatus.toLowerCase()] ?? []).includes(newStatus.toLowerCase());

/** Minutes left before a no-show may be recorded (0 once the grace period after start has passed). */
export const noShowMinutesLeft = (booking: { booking_date: string; start_time: string }, now: Date = new Date()) => {
    const graceCutoff = getBookingStart(booking).getTime() + NO_SHOW_GRACE_MINUTES * 60_000;
    return Math.max(0, Math.ceil((graceCutoff - now.getTime()) / 60_000));
};

/** Status update plus the audit timestamp that goes with it. */
export const buildStatusUpdate = (newStatus: string, now: string = new Date().toISOString()) => {
    const update: Record<string, unknown> = { status: newStatus };
    if (newStatus === "checked_in") update.checked_in_at = now;
    if (newStatus === "in_progress") update.started_at = now;
    if (newStatus === "completed") update.completed_at = now;
    if (newStatus === "no_show") update.no_show_at = now;
    if (newStatus === "cancelled") update.cancel_reason = "admin";
    return update;
};
