import { getBookingStart, getBookingEnd } from "../../utils/bookingTime.ts";

export interface CourtSlot {
    court_id: string | null;
    booking_date: string;
    start_time: string;
    end_time: string;
    status: string;
}

/** The slot is being played right now; a slot ending at 00:00 runs until midnight. */
export const isPlayingNow = (b: CourtSlot, now: Date = new Date()) =>
    b.status === "in_progress" || (getBookingStart(b) <= now && now < getBookingEnd(b));

/** The booking on this court right now, and the next one still to start. */
export function courtNowNext<T extends CourtSlot>(slots: T[], courtId: string, now: Date = new Date()) {
    const mine = slots
        .filter((s) => s.court_id === courtId && getBookingEnd(s) > now)
        .sort((a, b) => getBookingStart(a).getTime() - getBookingStart(b).getTime());
    return {
        current: mine.find((s) => isPlayingNow(s, now)) ?? null,
        next: mine.find((s) => getBookingStart(s) > now) ?? null,
    };
}

/** "Fri, Nov 7" for a YYYY-MM-DD venue date. */
export const shortDate = (date: string) =>
    new Date(`${date}T12:00:00+08:00`).toLocaleDateString("en-US", { timeZone: "Asia/Manila", weekday: "short", month: "short", day: "numeric" });
