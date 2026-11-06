import type { BookingSlot } from "./fetchBookingsForDate.service";
import { isBookingActive } from "./checkSlotAvailability.service.ts";
import { getBookingWeekday } from "./validateBookingSlot.service.ts";

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

// Open and close as whole hours, or null when the court can't be booked that day.
const dayWindow = (i: WalkInSlotInput) => {
    if (i.courtStatus === "closed" || i.courtStatus === "maintenance") return null;
    if (i.closedDates.includes(i.date)) return null;
    const row = i.hours.find((h) => h.day_of_week === getBookingWeekday(i.date));
    if (!row?.is_open || !row.open_time || !row.close_time) return null;
    return { open: Number(row.open_time.slice(0, 2)), close: Number(row.close_time.slice(0, 2)) };
};

const hourTaken = (i: WalkInSlotInput, h: number) => {
    const now = i.now ?? new Date();
    return i.bookings.some(
        (b) => b.court_id === i.courtId && isBookingActive(b, now) &&
            b.start_time.slice(0, 5) < hhmm(h + 1) && b.end_time.slice(0, 5) > hhmm(h)
    );
};

export function walkInStarts(input: WalkInSlotInput): StartOption[] {
    const w = dayWindow(input);
    if (!w) return [];
    const out: StartOption[] = [];
    for (let h = w.open; h <= w.close - input.minHours; h++) out.push({ time: hhmm(h), taken: hourTaken(input, h) || walkInEnds(input, hhmm(h)).length === 0 });
    return out;
}

export function walkInEnds(input: WalkInSlotInput, start: string): string[] {
    const w = dayWindow(input);
    if (!w) return [];
    const s = Number(start.slice(0, 2));
    const out: string[] = [];
    for (let end = s + 1; end <= w.close && !hourTaken(input, end - 1); end++) {
        if (end - s >= input.minHours) out.push(hhmm(end));
    }
    return out;
}
