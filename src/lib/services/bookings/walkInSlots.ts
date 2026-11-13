import type { BookingSlot } from "./fetchBookingsForDate.service";
import { isBookingActive } from "./checkSlotAvailability.service.ts";
import { bookableWindows } from "../schedule/hoursRules.ts";
import { bookableUntil } from "../../utils/bookingTime.ts";

export interface WalkInSlotInput {
    date: string;
    courtId: string;
    courtStatus: string;
    hours: { day_of_week: string; is_open: boolean; open_time?: string | null; close_time?: string | null }[];
    closedDates: string[];
    bookings: BookingSlot[];
    minHours: number;
    now?: Date;
}
export interface StartOption { time: string; taken: boolean }

const hhmm = (h: number) => `${String(h).padStart(2, "0")}:00`;

// The date's bookable windows as whole hours (late-night hours from the day before, then its own); none when the court can't be booked.
const dayWindows = (i: WalkInSlotInput) => {
    if (i.courtStatus === "closed" || i.courtStatus === "maintenance") return [];
    return bookableWindows(i.date, i.hours, i.closedDates).map((w) => ({ open: Number(w.start.slice(0, 2)), close: Number(w.end.slice(0, 2)) }));
};

const hourTaken = (i: WalkInSlotInput, h: number) => {
    const now = i.now ?? new Date();
    return i.bookings.some(
        (b) => b.court_id === i.courtId && isBookingActive(b, now) &&
            b.start_time.slice(0, 5) < hhmm(h + 1) && b.end_time.slice(0, 5) > hhmm(h)
    );
};

/** Start times staff can pick: like the customer grid, a slot stays open until its first hour ends (8:05 AM still offers 8 AM). */
export function walkInStarts(input: WalkInSlotInput): StartOption[] {
    const now = input.now ?? new Date();
    const out: StartOption[] = [];
    for (const w of dayWindows(input)) {
        for (let h = w.open; h <= w.close - input.minHours; h++) {
            if (bookableUntil({ booking_date: input.date, start_time: hhmm(h) }) <= now) continue;
            out.push({ time: hhmm(h), taken: hourTaken(input, h) || walkInEnds(input, hhmm(h)).length === 0 });
        }
    }
    return out;
}

/** End times for a start, within the same window: late-night hours never run on into the morning. An end at midnight is "24:00". */
export function walkInEnds(input: WalkInSlotInput, start: string): string[] {
    const s = Number(start.slice(0, 2));
    const w = dayWindows(input).find((x) => s >= x.open && s < x.close);
    if (!w) return [];
    const out: string[] = [];
    for (let end = s + 1; end <= w.close && !hourTaken(input, end - 1); end++) {
        if (end - s >= input.minHours) out.push(hhmm(end));
    }
    return out;
}
