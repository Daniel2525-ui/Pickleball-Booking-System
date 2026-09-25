import { Court } from "../courts/courtsTypes";
import { BookingSlot } from "./fetchBookingsForDate.service";

export const to24h = (time12h: string): string => {
    const match = time12h.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!match) return time12h;
    let hours = parseInt(match[1], 10);
    const minutes = match[2];
    const period = match[3].toUpperCase();
    if (period === "PM" && hours !== 12) hours += 12;
    if (period === "AM" && hours === 12) hours = 0;
    return `${hours < 10 ? "0" : ""}${hours}:${minutes}`;
};

export type SlotStatus = "available" | "booked" | "maintenance" | "closed" | "passed";

export const checkSlotAvailability = (
    courtName: string,
    timeRange: string,
    courts: Court[],
    bookings: BookingSlot[],
    date: Date
): SlotStatus => {
    const court = courts.find((c) => c.name === courtName);
    if (!court) return "closed";
    if (court.status === "maintenance") return "maintenance";
    if (court.status === "closed") return "closed";

    const [startStr, endStr] = timeRange.split(" - ");
    const slotStart = to24h(startStr.trim());
    const slotEnd = to24h(endStr.trim());

    // 3. Add logic to check if the time slot has already passed
    const now = new Date();
    const isToday =
        date.getDate() === now.getDate() &&
        date.getMonth() === now.getMonth() &&
        date.getFullYear() === now.getFullYear();

    if (isToday) {
        // Get current time in "HH:MM" format
        const currentTime = now.getHours().toString().padStart(2, "0") + ":" + now.getMinutes().toString().padStart(2, "0");
        if (slotStart <= currentTime) {
            return "passed";
        }
    }

    const isBooked = bookings.some((b) => {
        if (b.court_id !== court.id) return false;
        const bStart = b.start_time.slice(0, 5);
        const bEnd = b.end_time.slice(0, 5);
        return bStart < slotEnd && bEnd > slotStart;
    });

    return isBooked ? "booked" : "available";
};
