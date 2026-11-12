import { getBookingWeekday } from "../bookings/validateBookingSlot.service.ts";
import { formatTime12h } from "../../utils/formatTime.ts";
import { formatManilaDate, shiftDate } from "../../utils/bookingTime.ts";

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
 * Closing at or before the opening time means closing after midnight, the next morning; dayEndsAt
 * (booking_settings.day_ends_at) is the latest that can be, and the earliest a day can open.
 * Returns the first problem in staff wording, or the rows to store.
 */
export function checkWeeklyHours(hours: unknown, dayEndsAt = "00:00"): { error: string } | { rows: { day_of_week: string; is_open: boolean; open_time: string | null; close_time: string | null }[] } {
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
        const cutoff = dayEndsAt.slice(0, 5);
        if (open.slice(0, 5) < cutoff) return { error: `${day}: Opening can't be earlier than ${formatTime12h(cutoff)}, when the previous day ends.` };
        if (close.slice(0, 5) <= open.slice(0, 5) && close.slice(0, 5) > cutoff) return { error: `${day}: Closing time must be later than opening time, or after midnight up to ${formatTime12h(cutoff)}.` };
        rows.push({ day_of_week: day, is_open: true, open_time: open.slice(0, 5), close_time: close.slice(0, 5) });
    }
    return { rows };
}

/** True when a slot on this date falls outside the weekly hours (day closed, or before opening / after closing). */
export function isOutsideHours(slot: { booking_date: string; start_time: string; end_time: string }, hours: HoursInput[]) {
    return !isWithinWindows(bookableWindows(slot.booking_date, hours), slot.start_time, slot.end_time);
}

export interface BookableWindow {
    start: string;
    end: string;
    /** The previous day's hours running past midnight */
    lateNight?: true;
}

const hhmm = (time?: string | null) => (time ?? "").slice(0, 5);

/**
 * The times bookable on one weekday, as "HH:MM" pairs: the late-night tail of the previous day's hours
 * (00:00 until its closing), then the day's own hours (ending "24:00" when it closes after midnight).
 * Must match public.bookable_windows in SQL.
 */
export function windowsForWeekday(weekday: string, hours: HoursInput[]): BookableWindow[] {
    const row = (day: string) => {
        const h = hours.find((x) => x.day_of_week === day);
        return h?.is_open && h.open_time && h.close_time ? { open: hhmm(h.open_time), close: hhmm(h.close_time) } : null;
    };
    const windows: BookableWindow[] = [];
    const previous = row(WEEK_DAYS[(WEEK_DAYS.indexOf(weekday) + 6) % 7]);
    if (previous && previous.close <= previous.open && previous.close > "00:00") windows.push({ start: "00:00", end: previous.close, lateNight: true });
    const own = row(weekday);
    if (own) windows.push({ start: own.open, end: own.close <= own.open ? "24:00" : own.close });
    return windows;
}

/**
 * The bookable windows of a calendar date (YYYY-MM-DD). A closed date (venue_closures) closes its business day:
 * its own hours, and the late-night hours it would leave on the next date.
 */
export function bookableWindows(bookingDate: string, hours: HoursInput[], closedDates: string[] = []) {
    return windowsForWeekday(getBookingWeekday(bookingDate), hours)
        .filter((w) => !closedDates.includes(w.lateNight ? shiftDate(bookingDate, -1) : bookingDate));
}

/** One window must hold the whole slot, so 1-2 AM never joins 8-9 AM. */
export function isWithinWindows(windows: BookableWindow[], startTime: string, endTime: string) {
    return windows.some((w) => hhmm(startTime) >= w.start && hhmm(endTime) <= w.end);
}

/** "Open now · until 1:00 AM" from the weekly hours and the visitor's clock (Manila time). */
export function openNowLabel(hours: HoursInput[], now: Date) {
  const today = formatManilaDate(now);
  const weekday = getBookingWeekday(today);
  const clock = now.toLocaleTimeString("en-GB", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit", hour12: false });
  const windows = windowsForWeekday(weekday, hours);
  // A window ending at 24:00 runs on past midnight: show the real closing time
  const closeOf = (end: string) => (end === "24:00" ? hours.find((h) => h.day_of_week === weekday)?.close_time ?? "00:00" : end);
  const current = windows.find((w) => clock >= w.start && clock < w.end);
  if (current) return { open: true, text: `Open now · until ${formatTime12h(closeOf(current.end))}` };
  const next = windows.find((w) => clock < w.start);
  if (next) return { open: false, text: `Opens today at ${formatTime12h(next.start)}` };
  return { open: false, text: "Closed for today" };
}
