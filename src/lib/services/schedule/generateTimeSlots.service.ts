import { formatTime12h } from "../../utils/formatTime.ts";
import { formatManilaDate } from "../../utils/bookingTime.ts";
import { bookableWindows, type HoursInput } from "./hoursRules.ts";

const hhmm = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

/*
 * One-hour slot labels (e.g. "8:00 AM - 9:00 AM") for a calendar date: the late-night hours left over from
 * the day before, then the day's own hours. A slot ending at midnight reads "11:00 PM - 12:00 AM".
 * closedDates (venue_closures) remove a business day's hours, including its late night on the next date.
 */
export const generateTimeSlots = (selectedDate: Date, operatingHours: HoursInput[], closedDates: string[] = []): string[] => {
    if (!operatingHours || !operatingHours.length) return [];

    return bookableWindows(formatManilaDate(selectedDate), operatingHours, closedDates).flatMap((w) => {
        const slots = [];
        for (let h = Number(w.start.slice(0, 2)); h < Number(w.end.slice(0, 2)); h++) {
            slots.push(`${formatTime12h(hhmm(h))} - ${formatTime12h(hhmm(h + 1))}`);
        }
        return slots;
    });
};
