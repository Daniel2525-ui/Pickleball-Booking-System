/**
 * Shared booking date/time and timezone conversion utilities.
 * All bookings in Crosshair Dinkers are scheduled in venue local time (Asia/Manila, UTC+8, no DST).
 */

export const VENUE_TIMEZONE = "Asia/Manila";
export const VENUE_UTC_OFFSET = "+08:00";

export interface BookingTimeFields {
    booking_date: string;
    start_time: string;
}

/**
 * Returns the booking's start as an absolute Date instant, interpreting date/time in Asia/Manila (+08:00).
 */
export const getBookingStart = (
    booking: Pick<BookingTimeFields, "booking_date" | "start_time">
): Date => {
    const time =
        booking.start_time.length === 5
            ? `${booking.start_time}:00`
            : booking.start_time.slice(0, 8);
    return new Date(`${booking.booking_date}T${time}${VENUE_UTC_OFFSET}`);
};

const manilaDateFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: VENUE_TIMEZONE,
});

/** Formats a Date or date string to YYYY-MM-DD in Asia/Manila. */
export const formatManilaDate = (date: Date | string = new Date()): string => {
    const d = typeof date === "string" ? new Date(date) : date;
    return manilaDateFormatter.format(d);
};
