import { supabase } from "@/lib/supabase";
import { formatManilaDate, getBookingEnd } from "@/lib/utils/bookingTime";
import { getBookingDisplayStatus } from "@/lib/services/bookings/bookingDisplayStatus";

export interface VenueClosure {
    closed_on: string;
    reason: string | null;
}

/** Closed dates from today on, soonest first. */
export const fetchUpcomingClosures = async () => {
    const { data, error } = await supabase
        .from("venue_closures")
        .select("closed_on, reason")
        .gte("closed_on", formatManilaDate())
        .order("closed_on");
    if (error) console.error("Failed to load closed dates:", error);
    return { data: (data ?? []) as VenueClosure[], error };
};

const send = async (method: "POST" | "DELETE", body: object) => {
    try {
        const res = await fetch("/api/admin/closures", {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        const json = await res.json().catch(() => null);
        return res.ok ? { error: null } : { error: new Error(json?.error || "Could not update closed dates.") };
    } catch {
        return { error: new Error("Could not reach the server. Check your connection and try again.") };
    }
};

export const addClosure = (date: string, reason: string) => send("POST", { date, reason });
export const removeClosure = (date: string) => send("DELETE", { date });

export interface AffectedBooking {
    id: string;
    label: string;
    start_time: string;
    phone: string | null;
}

/** What is already booked on a date: court bookings and open play sessions, so staff can contact those players. */
export const fetchBookedOnDate = async (date: string) => {
    const [bookings, sessions] = await Promise.all([
        supabase
            .from("bookings")
            .select("id, booking_date, start_time, end_time, status, hold_expires_at, created_at, customer_name, courts(name), profiles(phone), customers(phone)")
            .eq("booking_date", date)
            .not("court_id", "is", null)
            .is("open_play_session_id", null) // open play court blocks are listed as their session below
            .in("status", ["pending", "confirmed", "checked_in", "in_progress"])
            .order("start_time"),
        supabase
            .from("open_play_sessions")
            .select("id, start_time")
            .eq("session_date", date)
            .eq("status", "open")
            .order("start_time"),
    ]);
    const error = bookings.error || sessions.error;
    if (error) console.error("Failed to load bookings on that date:", error);
    const now = new Date();
    type Row = { id: string; booking_date: string; start_time: string; end_time: string; status: string; hold_expires_at: string | null; created_at: string; customer_name: string | null; courts: { name: string } | null; profiles: { phone: string | null } | null; customers: { phone: string | null } | null };
    const court = ((bookings.data ?? []) as unknown as Row[])
        .filter((b) => getBookingEnd(b) > now && getBookingDisplayStatus(b, now) !== "hold_expired")
        .map((b) => ({
            id: b.id,
            label: `${b.customer_name || "Guest Player"} · ${b.courts?.name ?? "Court"}`,
            start_time: b.start_time,
            phone: b.customers?.phone || b.profiles?.phone || null,
        }));
    const openPlay = (sessions.data ?? []).map((s) => ({ id: s.id, label: "Open play session", start_time: s.start_time, phone: null }));
    return { data: [...court, ...openPlay].sort((a, b) => a.start_time.localeCompare(b.start_time)) as AffectedBooking[], error };
};
