import { Court } from "../courts/courtsTypes";
import { BookingSlot } from "./fetchBookingsForDate.service";

export const to24h = (time12h: string): string => {
    const match = time12h.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);

    if (!match) return time12h;

    let hours = Number(match[1]);
    const minutes = match[2];
    const period = match[3].toUpperCase();

    if (period === "PM" && hours < 12) hours += 12;
    if (period === "AM" && hours === 12) hours = 0;

    return `${String(hours).padStart(2, "0")}:${minutes}`;
};

export type SlotStatus = "available" | "booked" | "pending" | "user_pending" | "maintenance" | "closed" | "passed";

export const checkSlotAvailability = (
    courtName: string,
    timeRange: string,
    courts: Court[],
    bookings: BookingSlot[],
    date: Date,
    currentUserId?: string | null
): SlotStatus => {
    const court = courts.find((c) => c.name === courtName);
    if (!court) return "closed";
    if (court.status === "maintenance") return "maintenance";
    if (court.status === "closed") return "closed";

    const [startStr, endStr] = timeRange.split(" - ");
    const slotStart = to24h(startStr.trim());
    const slotEnd = to24h(endStr.trim());

    /* 3. Logic to check if the time slot has already passed */
    const now = new Date();
    const isToday =
        date.getDate() === now.getDate() &&
        date.getMonth() === now.getMonth() &&
        date.getFullYear() === now.getFullYear();

    if (isToday) {
        const currentTime = now.getHours().toString().padStart(2, "0") + ":" + now.getMinutes().toString().padStart(2, "0");
        if (slotStart <= currentTime) {
            return "passed";
        }
    }

    const matchingBookings = bookings.filter((booking) => {
        if (booking.court_id !== court.id) return false;
        const bookingStart = booking.start_time.slice(0, 5);
        const bookingEnd = booking.end_time.slice(0, 5);
        return bookingStart < slotEnd && bookingEnd > slotStart;
    });

    if (matchingBookings.length > 0) {
        const hasConfirmed = matchingBookings.some(
            (booking) => (booking.status || "").toLowerCase() !== "pending"
        );
        if (hasConfirmed) {
            return "booked";
        }
        if (currentUserId && matchingBookings.some((booking) => booking.user_id === currentUserId)) {
            return "user_pending";
        }
        return "pending";
    }

    return "available";
};

export const getSlotBooking = (
    courtName: string,
    timeRange: string,
    courts: Court[],
    bookings: BookingSlot[]
): BookingSlot | undefined => {
    const court = courts.find((court) => court.name === courtName);
    if (!court) return undefined;

    const [startStr, endStr] = timeRange.split(" - ");
    const slotStart = to24h(startStr.trim());
    const slotEnd = to24h(endStr.trim());

    return bookings.find((booking) => {
        if (booking.court_id !== court.id) return false;
        const bookingStart = booking.start_time.slice(0, 5);
        const bookingEnd = booking.end_time.slice(0, 5);
        return bookingStart < slotEnd && bookingEnd > slotStart;
    });
};
