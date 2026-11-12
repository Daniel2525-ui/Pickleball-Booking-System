/**
 * Shared booking date/time and timezone conversion utilities.
 * All bookings are scheduled in venue local time (Asia/Manila, UTC+8, no DST).
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

/** The booking's end instant in venue time; an end at or before the start (e.g. 00:00) is the next day. */
export const getBookingEnd = (booking: { booking_date: string; start_time: string; end_time: string }): Date => {
    const start = getBookingStart(booking);
    const end = getBookingStart({ booking_date: booking.booking_date, start_time: booking.end_time });
    return end > start ? end : new Date(end.getTime() + 24 * 60 * 60_000);
};

const manilaDateFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: VENUE_TIMEZONE,
});

/** Formats a Date or date string to YYYY-MM-DD in Asia/Manila. */
export const formatManilaDate = (date: Date | string = new Date()): string => {
    const d = typeof date === "string" ? new Date(date) : date;
    return manilaDateFormatter.format(d);
};

/** A YYYY-MM-DD venue date moved by whole days. */
export const shiftDate = (date: string, days: number): string =>
    formatManilaDate(new Date(new Date(`${date}T12:00:00${VENUE_UTC_OFFSET}`).getTime() + days * 86_400_000));

/**
 * The business day a booking belongs to: hours before dayEndsAt (booking_settings.day_ends_at) are the
 * previous day's late night. Must match public.business_date in SQL.
 */
export const businessDate = (bookingDate: string, startTime: string, dayEndsAt = "00:00"): string =>
    startTime.slice(0, 5) < dayEndsAt.slice(0, 5) ? shiftDate(bookingDate, -1) : bookingDate;

/** Today's business day: at 1 AM it is still yesterday. Must match public.business_day_of(now()). */
export const businessToday = (dayEndsAt = "00:00", now: Date = new Date()): string => {
    const [h, m] = dayEndsAt.split(":").map(Number);
    return formatManilaDate(new Date(now.getTime() - (h * 60 + (m || 0)) * 60_000));
};

/** "Friday late night" for a booking after midnight that belongs to the day before; null for any other. */
export const lateNightLabel = (bookingDate: string, startTime: string, dayEndsAt = "00:00"): string | null => {
    return lateNightOf({ booking_date: bookingDate, business_date: businessDate(bookingDate, startTime, dayEndsAt) });
};

/** The same label for a bookings row, from its stored business_date. */
export const lateNightOf = (b: { booking_date: string; business_date?: string | null }): string | null => {
    if (!b.business_date || b.business_date === b.booking_date) return null;
    const weekday = new Date(`${b.business_date}T12:00:00${VENUE_UTC_OFFSET}`).toLocaleDateString("en-US", { weekday: "long", timeZone: VENUE_TIMEZONE });
    return `${weekday} late night`;
};
