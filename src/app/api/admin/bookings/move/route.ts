import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const peso = (v: string) => `₱${Number(v).toLocaleString("en-PH")}`;

/** Staff wording for the refusals move_booking raises. */
const moveError = (message: string): string => {
    const after = (code: string) => message.split(`${code}:`)[1]?.trim() ?? "";
    if (message.includes("PRICE_CHANGES")) {
        const [from, to] = after("PRICE_CHANGES").split("|");
        return `This move changes the price from ${peso(from)} to ${peso(to)}. Cancel and rebook instead.`;
    }
    if (message.includes("SLOT_UNAVAILABLE")) return "That court is already booked at that time.";
    if (message.includes("NOT_MOVABLE")) return `${after("NOT_MOVABLE")}.`;
    if (message.includes("PAST_SLOT")) return "The new time has already started. Pick a later time.";
    if (message.includes("NO_CHANGE")) return "The booking is already at that court and time.";
    if (message.includes("VENUE_CLOSED")) return "The venue is closed on that day.";
    if (message.includes("OUTSIDE_OPERATING_HOURS")) return "The new time is outside the venue's opening hours.";
    if (message.includes("COURT_UNAVAILABLE")) return "That court is closed for maintenance.";
    if (message.includes("INVALID_TIME_INCREMENT")) return "Bookings start on the hour, like 6:00 PM.";
    if (message.includes("NOT_FOUND")) return "That booking or court no longer exists. Refresh and try again.";
    return "Could not move the booking. Please try again.";
};

/** Moves a confirmed court booking to another court, date or start time (same length, same price). */
export async function POST(request: NextRequest) {
    try {
        const { supabase, denied } = await requireAdmin();
        if (denied) return denied;

        const body = await request.json().catch(() => null);
        const bookingId = typeof body?.bookingId === "string" ? body.bookingId.trim() : "";
        const courtId = typeof body?.courtId === "string" ? body.courtId.trim() : "";
        const date = typeof body?.date === "string" ? body.date.trim() : "";
        const startTime = typeof body?.startTime === "string" ? body.startTime.trim() : "";

        if (!UUID.test(bookingId) || !UUID.test(courtId)) {
            return Response.json({ error: "Choose a booking and a court." }, { status: 400 });
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
            return Response.json({ error: "Choose a valid date." }, { status: 400 });
        }
        if (!/^([01]\d|2[0-3]):00$/.test(startTime)) {
            return Response.json({ error: "Bookings start on the hour, like 6:00 PM." }, { status: 400 });
        }

        const { data, error } = await supabase.rpc("move_booking", {
            p_booking_id: bookingId,
            p_court_id: courtId,
            p_booking_date: date,
            p_start_time: startTime,
        });

        if (error) {
            const known = /PRICE_CHANGES|SLOT_UNAVAILABLE|NOT_MOVABLE|PAST_SLOT|NO_CHANGE|VENUE_CLOSED|OUTSIDE_OPERATING_HOURS|COURT_UNAVAILABLE|INVALID_TIME_INCREMENT|NOT_FOUND/.test(error.message);
            if (!known) console.error("Move booking failed:", error);
            return Response.json({ error: moveError(error.message) }, { status: known ? 409 : 500 });
        }
        return Response.json({ data });
    } catch (error) {
        console.error("Move booking route error:", error);
        return Response.json({ error: "Unexpected error." }, { status: 500 });
    }
}
