import { getBookingStart } from "../../utils/bookingTime.ts";

export interface OperatingHourInfo {
    is_open: boolean;
    open_time: string | null;
    close_time: string | null;
}

export interface ValidateBookingSlotParams {
    bookingDate: string;
    startTime: string;
    endTime: string;
    operatingHour?: OperatingHourInfo | null;
    /** Admin-configured booking length limits (booking_settings) */
    limits: { min_hours: number; max_hours: number };
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
    const { bookingDate, startTime, endTime, operatingHour, limits, now = new Date() } = params;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(bookingDate) || Number.isNaN(Date.parse(bookingDate))) {
        return { valid: false, error: "Invalid booking date format. Expected YYYY-MM-DD." };
    }

    const wholeHourRegex = /^([01]\d|2[0-3]):00(:00)?$/;
    if (!wholeHourRegex.test(startTime) || !wholeHourRegex.test(endTime)) {
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

    if (!Number.isInteger(durationHours) || durationHours < limits.min_hours || durationHours > limits.max_hours) {
        return {
            valid: false,
            error: `Booking duration must be between ${limits.min_hours} and ${limits.max_hours} consecutive hours.`,
        };
    }

    const dayOfWeek = getBookingWeekday(bookingDate);

    if (operatingHour !== undefined) {
        if (!operatingHour || !operatingHour.is_open || !operatingHour.open_time || !operatingHour.close_time) {
            return { valid: false, error: "The venue is closed on this date." };
        }

        const openTimeDb = operatingHour.open_time.length === 5 ? `${operatingHour.open_time}:00` : operatingHour.open_time;
        const closeTimeDb = operatingHour.close_time.length === 5 ? `${operatingHour.close_time}:00` : operatingHour.close_time;

        if (startTimeDb < openTimeDb || endTimeDb > closeTimeDb) {
            return {
                valid: false,
                error: "The selected time range falls outside venue operating hours.",
            };
        }
    }

    const startInstant = getBookingStart({ booking_date: bookingDate, start_time: startTimeDb });
    if (Number.isNaN(startInstant.getTime()) || startInstant <= now) {
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
    start_time: string;
    end_time: string;
}

export type ValidateBasketResult =
    | {
          valid: true;
          lines: { courtId: string; courtName: string; startTimeDb: string; endTimeDb: string }[];
      }
    | { valid: false; error: string };

/**
 * Trust-boundary check for a basket: shape, court exists and is bookable, every line passes
 * validateBookingSlot, and times on the same court don't overlap. Errors name the court.
 */
export const validateBasketLines = (params: {
    bookingDate: string;
    lines: unknown;
    courts: { id: string; name: string; status: string }[];
    operatingHour?: OperatingHourInfo | null;
    limits: { min_hours: number; max_hours: number };
    now?: Date;
}): ValidateBasketResult => {
    const { bookingDate, lines, courts, operatingHour, limits, now } = params;
    if (!Array.isArray(lines) || lines.length === 0) {
        return { valid: false, error: "Select at least one court and time." };
    }

    const out: { courtId: string; courtName: string; startTimeDb: string; endTimeDb: string }[] = [];
    for (const [i, line] of lines.entries()) {
        const { court_id, start_time, end_time } = (line ?? {}) as Partial<BasketLineInput>;
        if (typeof court_id !== "string" || typeof start_time !== "string" || typeof end_time !== "string" || !court_id) {
            return { valid: false, error: `Line ${i + 1}: Missing required booking details.` };
        }
        const court = courts.find((c) => c.id === court_id);
        if (!court) return { valid: false, error: `Line ${i + 1}: Invalid court.` };
        if (court.status === "maintenance" || court.status === "closed") {
            return { valid: false, error: `${court.name}: This court is currently not available for reservations.` };
        }
        const v = validateBookingSlot({ bookingDate, startTime: start_time, endTime: end_time, operatingHour, limits, now });
        if (!v.valid) return { valid: false, error: `${court.name}: ${v.error}` };
        // Separate times on one court are fine; overlapping ones would double-book it (times are HH:MM:SS, so they compare as strings)
        if (out.some((o) => o.courtId === court_id && v.startTimeDb < o.endTimeDb && o.startTimeDb < v.endTimeDb)) {
            return { valid: false, error: `${court.name}: two of your times overlap.` };
        }
        out.push({ courtId: court_id, courtName: court.name, startTimeDb: v.startTimeDb, endTimeDb: v.endTimeDb });
    }
    return { valid: true, lines: out };
};
