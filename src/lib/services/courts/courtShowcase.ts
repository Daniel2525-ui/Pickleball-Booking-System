import { getBookingEnd, getBookingStart } from "../../utils/bookingTime.ts";
import { formatTime12h } from "../../utils/formatTime.ts";

export type ShowcaseState = "busy" | "free" | "off";

interface ShowcaseCourt { id: string; status: string | null; maintenance_note?: string | null }
interface ShowcaseSlot { court_id: string | null; start_time: string; end_time: string; status?: string }
interface DayHours { is_open: boolean; open_time: string | null; close_time: string | null }

/**
 * What a guest sees for one court right now on the landing page.
 * `slots` are today's rows from get_public_slot_availability, which already drops expired holds,
 * so every row counts as taken (other players' hold times are masked to null there).
 */
export function courtShowcaseStatus(court: ShowcaseCourt, slots: ShowcaseSlot[], hours: DayHours | null, today: string, now: Date) {
    if (court.status === "maintenance") return { state: "off" as const, label: "Maintenance", detail: court.maintenance_note || "Not bookable right now" };
    if (court.status === "closed") return { state: "off" as const, label: "Closed", detail: court.maintenance_note || "Not bookable right now" };

    const day = (start: string, end: string) => ({ start: getBookingStart({ booking_date: today, start_time: start }), end: getBookingEnd({ booking_date: today, start_time: start, end_time: end }) });
    const venue = hours?.is_open && hours.open_time && hours.close_time ? day(hours.open_time, hours.close_time) : null;
    if (!venue || now >= venue.end) return { state: "off" as const, label: "Closed now", detail: "Closed for the day" };
    if (now < venue.start) return { state: "off" as const, label: "Closed now", detail: `Opens ${formatTime12h(hours!.open_time!)}` };

    const mine = slots
        .filter((s) => s.court_id === court.id)
        .map((s) => ({ ...day(s.start_time, s.end_time), start_time: s.start_time, end_time: s.end_time }))
        .filter((s) => s.end > now)
        .sort((a, b) => a.start.getTime() - b.start.getTime());

    const current = mine.find((s) => s.start <= now);
    if (current) {
        // Back-to-back bookings keep the court busy until the last one ends
        let last = current;
        for (const s of mine) if (s.start.getTime() === last.end.getTime()) last = s;
        return { state: "busy" as const, label: "In play", detail: `Free from ${formatTime12h(last.end_time)}` };
    }
    const next = mine[0];
    return { state: "free" as const, label: "Free now", detail: next ? `Free until ${formatTime12h(next.start_time)}` : "No more bookings today" };
}
