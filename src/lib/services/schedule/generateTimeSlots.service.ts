import { formatTime12h } from "../../utils/formatTime.ts";
import { formatManilaDate } from "../../utils/bookingTime.ts";
import { businessDayWindows, type HoursInput } from "./hoursRules.ts";

const hhmm = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

/*
 * One-hour slot labels (e.g. "8:00 AM - 9:00 AM") for a business day: its own hours, then the hours it runs on
 * past midnight (stored on the next date; midnightIndex finds where they start). A slot ending at midnight reads
 * "11:00 PM - 12:00 AM". closedDates (venue_closures) remove a business day's hours, its late night included.
 */
export const generateTimeSlots = (selectedDate: Date, operatingHours: HoursInput[], closedDates: string[] = []): string[] => {
    if (!operatingHours || !operatingHours.length) return [];

    return businessDayWindows(formatManilaDate(selectedDate), operatingHours, closedDates).flatMap((w) => {
        const slots = [];
        for (let h = Number(w.start.slice(0, 2)); h < Number(w.end.slice(0, 2)); h++) {
            slots.push(`${formatTime12h(hhmm(h))} - ${formatTime12h(hhmm(h + 1))}`);
        }
        return slots;
    });
};
