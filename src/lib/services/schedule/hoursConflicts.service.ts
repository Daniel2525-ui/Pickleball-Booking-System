import { supabase } from "@/lib/supabase";
import { formatManilaDate, getBookingEnd } from "@/lib/utils/bookingTime";
import { formatShortDate, formatTime12h } from "@/lib/utils/formatTime";
import { getBookingDisplayStatus } from "@/lib/services/bookings/bookingDisplayStatus";
import { HoursInput, isOutsideHours, isWithinWindows, windowsForWeekday } from "./hoursRules";

/**
 * Upcoming court bookings and active open play schedules that new weekly hours would leave outside opening hours.
 * Returned as lines staff can read in a confirm dialog; saving does not change any of them.
 */
export const findHoursConflicts = async (hours: HoursInput[]) => {
    const [bookings, schedules] = await Promise.all([
        supabase
            .from("bookings")
            .select("booking_date, start_time, end_time, status, hold_expires_at, created_at, customer_name, courts(name), profiles(phone), customers(phone)")
            .gte("booking_date", formatManilaDate())
            .not("court_id", "is", null)
            .is("open_play_session_id", null) // open play is checked through its schedule below
            .in("status", ["pending", "confirmed", "checked_in", "in_progress"])
            .order("booking_date")
            .order("start_time"),
        supabase.from("open_play_schedules").select("day_of_week, start_time, end_time").eq("active", true),
    ]);
    const error = bookings.error || schedules.error;
    if (error) console.error("Failed to check bookings against the new hours:", error);

    const now = new Date();
    type Row = { booking_date: string; start_time: string; end_time: string; status: string; hold_expires_at: string | null; created_at: string; customer_name: string | null; courts: { name: string } | null; profiles: { phone: string | null } | null; customers: { phone: string | null } | null };
    const bookingLines = ((bookings.data ?? []) as unknown as Row[])
        .filter((b) => getBookingEnd(b) > now && getBookingDisplayStatus(b, now) !== "hold_expired" && isOutsideHours(b, hours))
        .map((b) => {
            const phone = b.customers?.phone || b.profiles?.phone;
            return `${b.customer_name || "Guest Player"} · ${b.courts?.name ?? "Court"} · ${formatShortDate(b.booking_date)} ${formatTime12h(b.start_time)}${phone ? ` · ${phone}` : ""}`;
        });
    const openPlayLines = (schedules.data ?? [])
        .filter((s) => !isWithinWindows(windowsForWeekday(s.day_of_week, hours), s.start_time, s.end_time))
        .map((s) => `Open play · ${s.day_of_week}s ${formatTime12h(s.start_time)}–${formatTime12h(s.end_time)}`);

    return { data: [...bookingLines, ...openPlayLines], error };
};
