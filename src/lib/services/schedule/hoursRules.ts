import { getBookingWeekday } from "../bookings/validateBookingSlot.service.ts";

export const WEEK_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export interface HoursInput {
    day_of_week: string;
    is_open: boolean;
    open_time?: string | null;
    close_time?: string | null;
}

// Slots are whole hours (generateTimeSlots, checkout), so hours must be too: "08:00" or "08:00:00"
const WHOLE_HOUR = /^([01]\d|2[0-3]):00(:00)?$/;

/**
 * Checks a weekly schedule before it is saved (page and API route share it).
 * Returns the first problem in staff wording, or the rows to store.
 */
export function checkWeeklyHours(hours: unknown): { error: string } | { rows: { day_of_week: string; is_open: boolean; open_time: string | null; close_time: string | null }[] } {
    if (!Array.isArray(hours) || hours.length === 0) return { error: "Operating hours data is required." };
    const seen = new Set<string>();
    const rows = [];
    for (const raw of hours as HoursInput[]) {
        const day = raw?.day_of_week;
        if (typeof day !== "string" || !WEEK_DAYS.includes(day) || seen.has(day)) return { error: "Each day of the week can appear only once." };
        seen.add(day);
        if (!raw.is_open) {
            rows.push({ day_of_week: day, is_open: false, open_time: null, close_time: null });
            continue;
        }
        const open = raw.open_time ?? "";
        const close = raw.close_time ?? "";
        if (!WHOLE_HOUR.test(open) || !WHOLE_HOUR.test(close)) return { error: `${day}: Use whole hours, like 8:00 AM, for opening and closing.` };
        if (close.slice(0, 5) <= open.slice(0, 5)) return { error: `${day}: Closing time must be later than opening time.` };
        rows.push({ day_of_week: day, is_open: true, open_time: open.slice(0, 5), close_time: close.slice(0, 5) });
    }
    return { rows };
}

/** True when a slot on this date falls outside the weekly hours (day closed, or before opening / after closing). */
export function isOutsideHours(slot: { booking_date: string; start_time: string; end_time: string }, hours: HoursInput[]) {
    const day = hours.find((h) => h.day_of_week === getBookingWeekday(slot.booking_date));
    if (!day?.is_open || !day.open_time || !day.close_time) return true;
    return slot.start_time.slice(0, 5) < day.open_time.slice(0, 5) || slot.end_time.slice(0, 5) > day.close_time.slice(0, 5);
}
