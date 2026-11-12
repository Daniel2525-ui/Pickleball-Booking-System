import { bookableUntil, shiftDate } from "../../utils/bookingTime.ts";

export interface ValidateBookingSlotParams {
    bookingDate: string;
    startTime: string;
    endTime: string;
    /** The date's bookable windows (bookableWindows in hoursRules), empty when the venue is closed. Omit to skip the hours check. */
    windows?: { start: string; end: string }[];
    /** Admin-configured booking length limits (booking_settings) */
    limits: { min_hours: number };
    now?: Date;
}

export type ValidateBookingSlotResult =
    | {
          valid: true;
          durationHours: number;
          startTimeDb: string;
          endTimeDb: string;
          dayOfWeek: string;
      }
    | {
          valid: false;
          error: string;
      };

/**
 * Returns the day of the week in Asia/Manila for a given YYYY-MM-DD date.
 * Uses noon (+08:00) to guarantee zero date shift across any system timezone.
 */
export const getBookingWeekday = (bookingDate: string): string => {
    const targetDateInManila = new Date(`${bookingDate}T12:00:00+08:00`);
    return new Intl.DateTimeFormat("en-US", {
        weekday: "long",
        timeZone: "Asia/Manila",
    }).format(targetDateInManila);
};

/**
 * Validates date format, whole-hour boundaries, the configured duration limits,
 * operating hours, and past dates/times on the server in Asia/Manila context.
 */
export const validateBookingSlot = (
    params: ValidateBookingSlotParams
): ValidateBookingSlotResult => {
    const { bookingDate, startTime, endTime, windows, limits, now = new Date() } = params;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(bookingDate) || Number.isNaN(Date.parse(bookingDate))) {
        return { valid: false, error: "Invalid booking date format. Expected YYYY-MM-DD." };
    }

    const wholeHourRegex = /^([01]\d|2[0-3]):00(:00)?$/;
    // A booking never crosses midnight, so the latest end is 24:00
    if (!wholeHourRegex.test(startTime) || !(wholeHourRegex.test(endTime) || /^24:00(:00)?$/.test(endTime))) {
        return {
            valid: false,
            error: "Reservations must be booked in whole-hour increments on the hour.",
        };
    }

    const startTimeDb = startTime.length === 5 ? `${startTime}:00` : startTime;
    const endTimeDb = endTime.length === 5 ? `${endTime}:00` : endTime;

    const startHour = parseInt(startTimeDb.slice(0, 2), 10);
    const endHour = parseInt(endTimeDb.slice(0, 2), 10);
    const durationHours = endHour - startHour;

    if (!Number.isInteger(durationHours) || durationHours < limits.min_hours) {
        return {
            valid: false,
            error: `Bookings must be at least ${limits.min_hours} ${limits.min_hours === 1 ? "hour" : "hours"} long, in whole hours.`,
        };
    }

    const dayOfWeek = getBookingWeekday(bookingDate);

    if (windows !== undefined) {
        if (windows.length === 0) {
            return { valid: false, error: "The venue is closed on this date." };
        }

        // One window must hold the whole slot, so late-night hours never join the morning's
        if (!windows.some((w) => startTimeDb.slice(0, 5) >= w.start && endTimeDb.slice(0, 5) <= w.end)) {
            return {
                valid: false,
                error: "The selected time range falls outside venue operating hours.",
            };
        }
    }

    const closesAt = bookableUntil({ booking_date: bookingDate, start_time: startTimeDb });
    if (Number.isNaN(closesAt.getTime()) || closesAt <= now) {
        return { valid: false, error: "The requested time slot has already passed." };
    }

    return {
        valid: true,
        durationHours,
        startTimeDb,
        endTimeDb,
        dayOfWeek,
    };
};

export interface BasketLineInput {
    court_id: string;
    /** The date it is stored on; a business day's after-midnight hours are on the next date. Defaults to the basket's. */
    booking_date?: string;
    start_time: string;
    end_time: string;
}

type BasketLine = { courtId: string; courtName: string; bookingDate: string; startTimeDb: string; endTimeDb: string };

export type ValidateBasketResult =
    | {
          valid: true;
          lines: BasketLine[];
      }
    | { valid: false; error: string };

/**
 * True when hold_court_basket held every line on the date it was sent with. An older database function ignores
 * line dates and would hold a night's 12 AM hour on the wrong date, so checkout must not go on to payment.
 */
export const heldOnTheirDates = (
    lines: BasketLine[],
    items: { court_id: string; booking_date?: string; start_time: string }[]
) => items.every((i) => lines.some((l) => l.courtId === i.court_id && l.bookingDate === i.booking_date && l.startTimeDb === i.start_time));

const hoursOf = (l: BasketLine) => Number(l.endTimeDb.slice(0, 2)) - Number(l.startTimeDb.slice(0, 2));

/**
 * Trust-boundary check for a basket: shape, court exists and is bookable, every line passes
 * validateBookingSlot on its own date and inside that date's part of the business day, times on the same court
 * and date don't overlap, and each run is at least the minimum (one ending 24:00 and the same court's from
 * 00:00 the next date are one run). Errors name the court.
 */
export const validateBasketLines = (params: {
    bookingDate: string;
    lines: unknown;
    courts: { id: string; name: string; status: string }[];
    /** businessDayWindows: each window's `date` is the date its hours are stored on (bookingDate when omitted) */
    windows?: { start: string; end: string; date?: string }[];
    limits: { min_hours: number };
    now?: Date;
}): ValidateBasketResult => {
    const { bookingDate, lines, courts, windows, limits, now } = params;
    if (!Array.isArray(lines) || lines.length === 0) {
        return { valid: false, error: "Select at least one court and time." };
    }

    const out: BasketLine[] = [];
    for (const [i, line] of lines.entries()) {
        const { court_id, booking_date = bookingDate, start_time, end_time } = (line ?? {}) as Partial<BasketLineInput>;
        if (typeof court_id !== "string" || typeof start_time !== "string" || typeof end_time !== "string" || typeof booking_date !== "string" || !court_id) {
            return { valid: false, error: `Line ${i + 1}: Missing required booking details.` };
        }
        const court = courts.find((c) => c.id === court_id);
        if (!court) return { valid: false, error: `Line ${i + 1}: Invalid court.` };
        if (court.status === "maintenance" || court.status === "closed") {
            return { valid: false, error: `${court.name}: This court is currently not available for reservations.` };
        }
        const dayWindows = windows?.filter((w) => (w.date ?? bookingDate) === booking_date);
        // A date outside the business day has no windows here, which would read as "closed": say outside hours instead
        if (windows?.length && !dayWindows?.length) {
            return { valid: false, error: `${court.name}: The selected time range falls outside venue operating hours.` };
        }
        // The minimum is checked per run below, once the other side of midnight is known
        const v = validateBookingSlot({ bookingDate: booking_date, startTime: start_time, endTime: end_time, windows: dayWindows, limits: { min_hours: 1 }, now });
        if (!v.valid) return { valid: false, error: `${court.name}: ${v.error}` };
        // Separate times on one court are fine; overlapping ones would double-book it (times are HH:MM:SS, so they compare as strings)
        if (out.some((o) => o.courtId === court_id && o.bookingDate === booking_date && v.startTimeDb < o.endTimeDb && o.startTimeDb < v.endTimeDb)) {
            return { valid: false, error: `${court.name}: two of your times overlap.` };
        }
        out.push({ courtId: court_id, courtName: court.name, bookingDate: booking_date, startTimeDb: v.startTimeDb, endTimeDb: v.endTimeDb });
    }

    for (const l of out) {
        const joined = out.find(
            (o) =>
                o.courtId === l.courtId &&
                ((l.endTimeDb === "24:00:00" && o.startTimeDb === "00:00:00" && o.bookingDate === shiftDate(l.bookingDate, 1)) ||
                    (l.startTimeDb === "00:00:00" && o.endTimeDb === "24:00:00" && o.bookingDate === shiftDate(l.bookingDate, -1)))
        );
        if (hoursOf(l) + (joined ? hoursOf(joined) : 0) < limits.min_hours) {
            return {
                valid: false,
                error: `${l.courtName}: Bookings must be at least ${limits.min_hours} ${limits.min_hours === 1 ? "hour" : "hours"} long, in whole hours.`,
            };
        }
    }
    return { valid: true, lines: out };
};
