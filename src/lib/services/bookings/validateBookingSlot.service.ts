import { calculateCourtPrice } from "../courts/calculateCourtPrice.service.ts";
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
    now?: Date;
}

export type ValidateBookingSlotResult =
    | {
          valid: true;
          durationHours: number;
          startTimeDb: string;
          endTimeDb: string;
          amount: number;
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
 * Validates date format, whole-hour boundaries, duration limits (1-3 hours),
 * operating hours, and past dates/times on the server in Asia/Manila context.
 */
export const validateBookingSlot = (
    params: ValidateBookingSlotParams
): ValidateBookingSlotResult => {
    const { bookingDate, startTime, endTime, operatingHour, now = new Date() } = params;

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

    if (!Number.isInteger(durationHours) || durationHours < 1 || durationHours > 3) {
        return {
            valid: false,
            error: "Booking duration must be between 1 and 3 consecutive hours.",
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

    const amount = calculateCourtPrice(durationHours);

    return {
        valid: true,
        durationHours,
        startTimeDb,
        endTimeDb,
        amount,
        dayOfWeek,
    };
};
