import { getBookingStart, getBookingEnd } from "../../utils/bookingTime.ts";

export interface CourtSlot {
    court_id: string | null;
    booking_date: string;
    start_time: string;
    end_time: string;
    status: string;
    hold_expires_at?: string | null;
}

/** The booking still holds its court: any live status, or a pending one whose hold hasn't run out
 *  (the database may hold a booking with no end: 'infinity'). Same rule as the database. */
export const holdsCourt = (b: CourtSlot, now: Date = new Date()) =>
    b.status !== "pending" || b.hold_expires_at === "infinity" || (!!b.hold_expires_at && new Date(b.hold_expires_at) > now);

/** The slot is being played right now; a slot ending at 00:00 runs until midnight. */
export const isPlayingNow = (b: CourtSlot, now: Date = new Date()) =>
    b.status === "in_progress" || (getBookingStart(b) <= now && now < getBookingEnd(b));

/** The booking on this court right now, and the next one still to start. */
export function courtNowNext<T extends CourtSlot>(slots: T[], courtId: string, now: Date = new Date()) {
    const mine = slots
        .filter((s) => s.court_id === courtId && getBookingEnd(s) > now && holdsCourt(s, now))
        .sort((a, b) => getBookingStart(a).getTime() - getBookingStart(b).getTime());
    return {
        current: mine.find((s) => isPlayingNow(s, now)) ?? null,
        next: mine.find((s) => getBookingStart(s) > now) ?? null,
    };
}
