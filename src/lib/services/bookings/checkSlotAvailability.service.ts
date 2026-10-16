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

export type SlotStatus =
    | "available"
    | "booked"
    | "pending"
    | "user_pending"
    | "maintenance"
    | "closed"
    | "passed";

// Reuse the same timezone formatter.
const manilaDateFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
});

// Convert a time range into comparable 24-hour times.
const getSlotTimes = (timeRange: string) => {
    const [start, end] = timeRange.split(" - ");

    return {
        start: to24h(start.trim()),
        end: to24h(end.trim()),
    };
};

// Find all bookings that overlap the selected time slot.
const getOverlappingBookings = (
    courtId: Court["id"],
    timeRange: string,
    bookings: BookingSlot[]
): BookingSlot[] => {
    const { start, end } = getSlotTimes(timeRange);

    return bookings.filter((booking) => {
        if (booking.court_id !== courtId) return false;

        const bookingStart = booking.start_time.slice(0, 5);
        const bookingEnd = booking.end_time.slice(0, 5);

        return bookingStart < end && bookingEnd > start;
    });
};

export const checkSlotAvailability = (
    courtName: string,
    timeRange: string,
    courts: Court[],
    bookings: BookingSlot[],
    date: Date,
    currentUserId?: string | null
): SlotStatus => {
    const court = courts.find((court) => court.name === courtName);

    if (!court || court.status === "closed") return "closed";
    if (court.status === "maintenance") return "maintenance";

    const now = new Date();
    const today = manilaDateFormatter.format(now);
    const slotDate = manilaDateFormatter.format(date);

    if (slotDate < today) return "passed";

    if (slotDate === today) {
        const currentTime = now.toLocaleTimeString("en-GB", {
            timeZone: "Asia/Manila",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
        });

        const { start } = getSlotTimes(timeRange);

        if (start <= currentTime) return "passed";
    }

    const matchingBookings = getOverlappingBookings(
        court.id,
        timeRange,
        bookings
    );

    if (matchingBookings.length === 0) return "available";

    const hasConfirmed = matchingBookings.some(
        (booking) => (booking.status || "").toLowerCase() !== "pending"
    );

    if (hasConfirmed) return "booked";

    const belongsToUser = matchingBookings.some(
        (booking) => booking.user_id === currentUserId
    );

    return belongsToUser ? "user_pending" : "pending";
};

export const getSlotBooking = (
    courtName: string,
    timeRange: string,
    courts: Court[],
    bookings: BookingSlot[]
): BookingSlot | undefined => {
    const court = courts.find((court) => court.name === courtName);

    if (!court) return undefined;

    return getOverlappingBookings(
        court.id,
        timeRange,
        bookings
    )[0];
};
