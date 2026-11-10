/**
 * Customer booking cancellation.
 *
 * The eligibility rules live here so the My Bookings UI (which decides whether
 * to show the Cancel button) and the /api/bookings/cancel route (which actually
 * enforces the rules on the server) always agree.
 */

/** Statuses a customer is allowed to cancel. Paid bookings are non-refundable: staff handle those. */
export const customerCancellableStatuses = ["pending"] as const;

/** Exact status value stored in the database for cancelled bookings. */
export const CANCELLED_STATUS = "cancelled";

// Relative import so node:test can load this module without the @/ alias
import { getBookingStart } from "../../utils/bookingTime.ts";
export { getBookingStart };

interface CancellableBookingFields {
    status: string;
    booking_date: string;
    start_time: string;
    hold_expires_at?: string | null;
}

/**
 * Returns null if the customer may cancel the booking, otherwise a human-readable reason.
 */
export const getCancellationBlockReason = (
    booking: CancellableBookingFields,
    now: Date = new Date()
): string | null => {
    const status = (booking.status || "").toLowerCase();

    if (status === CANCELLED_STATUS) return "This booking has already been cancelled.";

    if (status === "confirmed") {
        return "Paid bookings are non-refundable and can't be cancelled online. Please contact the venue for help.";
    }

    if (!(customerCancellableStatuses as readonly string[]).includes(status)) {
        return `Bookings with status "${booking.status}" can no longer be cancelled.`;
    }

    const start = getBookingStart(booking);
    if (Number.isNaN(start.getTime())) return "This booking has an invalid date or time.";
    if (start <= now) return "This booking has already started and can no longer be cancelled.";

    return null;
};

export const isBookingCancellable = (booking: CancellableBookingFields, now: Date = new Date()) =>
    getCancellationBlockReason(booking, now) === null;

export interface CancelledBooking {
    id: string;
    status: string;
}

/**
 * Cancels one of the current user's bookings.
 * Ownership, status and timing are enforced server-side by /api/bookings/cancel.
 */
export const cancelBooking = async (
    bookingId: string
): Promise<{ data: CancelledBooking | null; error: Error | null }> => {
    try {
        const res = await fetch("/api/bookings/cancel", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ bookingId }),
        });

        const body = await res.json().catch(() => null);

        if (!res.ok || !body?.booking) {
            return {
                data: null,
                error: new Error(body?.error || "Failed to cancel booking. Please try again."),
            };
        }

        return { data: body.booking as CancelledBooking, error: null };
    } catch (error) {
        console.error("Failed to cancel booking:", error);
        return {
            data: null,
            error: new Error("Network error while cancelling the booking. Please check your connection and try again."),
        };
    }
};
