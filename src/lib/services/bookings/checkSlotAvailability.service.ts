import type { Court } from "../courts/courtsTypes";
import type { BookingSlot } from "./fetchBookingsForDate.service";
import { HOLD_MS } from "./bookingDisplayStatus.ts";

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
    | "open_play"
    | "pending"
    | "user_pending"
    | "maintenance"
    | "closed"
    | "passed";

// Reuse the same timezone formatter.
const manilaDateFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
});

/** A slot label's start and end as 24-hour times; an end at midnight is "24:00" so it sorts after its start. */
export const slotTimes = (timeRange: string) => {
    const [start, end] = timeRange.split(" - ").map((t) => to24h(t.trim()));
    return { start, end: end === "00:00" ? "24:00" : end };
};

// Find all bookings that overlap the selected time slot.
const getOverlappingBookings = (
    courtId: Court["id"],
    timeRange: string,
    bookings: BookingSlot[]
): BookingSlot[] => {
    const { start, end } = slotTimes(timeRange);

    return bookings.filter((booking) => {
        if (booking.court_id !== courtId) return false;

        const bookingStart = booking.start_time.slice(0, 5);
        const bookingEnd = booking.end_time.slice(0, 5);

        return bookingStart < end && bookingEnd > start;
    });
};

/**
 * Determines whether a booking slot actively claims/blocks court availability.
 * - Non-pending active statuses ('confirmed', 'completed', 'checked_in', 'in_progress') are always active.
 * - Inactive terminal statuses ('cancelled', 'no_show') never block availability.
 * - Pending holds check hold_expires_at (falling back to created_at + 15 minutes) plus the grace period below.
 * - If both timestamps are missing/invalid, fails conservatively to active (never silently frees a slot without established expiry).
 */
// Must match public.hold_release_after(): an expired hold keeps its slot this long so a late Stripe payment can still confirm it
export const HOLD_RELEASE_GRACE_MS = 20 * 60 * 1000;

export const isBookingActive = (b: BookingSlot, now: Date = new Date()): boolean => {
    const status = (b.status || "").toLowerCase();

    // Cancelled or no-show bookings never block availability
    if (status === "cancelled" || status === "no_show") {
        return false;
    }

    // Confirmed / checked-in / in_progress / completed bookings block availability
    if (status !== "pending") {
        return true;
    }

    // An infinite hold (the database may keep one open) parses as NaN: keep it held
    if (b.hold_expires_at === "infinity") return true;

    // Pending hold expiry evaluation
    const holdExpiryMs = b.hold_expires_at ? new Date(b.hold_expires_at).getTime() : NaN;
    const createdMs = b.created_at ? new Date(b.created_at).getTime() : NaN;

    if (!isNaN(holdExpiryMs)) {
        return holdExpiryMs + HOLD_RELEASE_GRACE_MS > now.getTime();
    }

    if (!isNaN(createdMs)) {
        return (createdMs + HOLD_MS + HOLD_RELEASE_GRACE_MS) > now.getTime();
    }

    // Conservative fallback: do not silently free slot if hold expiry cannot be established safely
    return true;
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

        const { start } = slotTimes(timeRange);

        if (start <= currentTime) return "passed";
    }

    const matchingBookings = getOverlappingBookings(
        court.id,
        timeRange,
        bookings
    );

    const activeBookings = matchingBookings.filter((b) => isBookingActive(b, now));

    if (activeBookings.length === 0) return "available";

    const hasConfirmed = activeBookings.some(
        (booking) => (booking.status || "").toLowerCase() !== "pending"
    );

    if (hasConfirmed) return activeBookings.some((b) => b.open_play) ? "open_play" : "booked";

    const belongsToUser = activeBookings.some(
        (booking) => Boolean(currentUserId) && Boolean(booking.user_id) && booking.user_id === currentUserId
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

    const matching = getOverlappingBookings(court.id, timeRange, bookings);
    const now = new Date();
    return matching.find((b) => isBookingActive(b, now));
};
