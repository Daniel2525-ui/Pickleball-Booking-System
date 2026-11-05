import { supabase } from "@/lib/supabase";
import { Court } from "./courtsTypes";
import { isPlayingNow } from "./courtDay";
import { formatManilaDate } from "@/lib/utils/bookingTime";

export interface ActiveBookingSnippet {
    court_id: string;
    booking_date: string;
    status: string;
    start_time: string;
    end_time: string;
}

export const fetchCourtsData = async (activeBookingsOverride?: ActiveBookingSnippet[]) => {
    try {
        const { data: courts, error: courtsError } = await supabase
            .from("courts")
            .select("id, name, status, maintenance_note, maintenance_until")
            .order("name", { ascending: true });

        if (courtsError) throw courtsError;

        let activeBookings = activeBookingsOverride;

        if (!activeBookings) {
            // Find if any court is currently occupied (in Asia/Manila timezone)
            const currentDate = new Intl.DateTimeFormat("en-CA", {
                timeZone: "Asia/Manila",
            }).format(new Date());

            const { data, error: bookingsError } = await supabase
                .from("bookings")
                .select("court_id, booking_date, status, start_time, end_time")
                .eq("booking_date", currentDate)
                .in("status", ["confirmed", "checked_in", "in_progress"]);

            if (bookingsError) throw bookingsError;
            activeBookings = data || [];
        }

        const now = new Date();
        const occupiedCourtIds = new Set(
            (activeBookings || []).filter((b) => isPlayingNow(b, now)).map((b) => b.court_id)
        );

        const updatedCourts = (courts || []).map(court => {
            let finalStatus = court.status;
            if ((court.status === "active" || court.status === "available") && occupiedCourtIds.has(court.id)) {
                finalStatus = "occupied";
            }
            return {
                ...court,
                status: finalStatus,
            };
        });

        return { data: updatedCourts as Court[], error: null };
    } catch (error) {
        console.error("Failed to fetch courts", error);
        return { data: [], error };
    }
}
export interface CourtBooking {
    id: string;
    court_id: string;
    booking_date: string;
    start_time: string;
    end_time: string;
    status: string;
    hold_expires_at: string | null;
    created_at: string;
    open_play_session_id: string | null;
    customer_name: string | null;
    profiles: { full_name: string; phone: string | null } | null;
    customers: { full_name: string; phone: string | null } | null;
}

const COURT_BOOKING_COLUMNS =
    "id, court_id, booking_date, start_time, end_time, status, hold_expires_at, created_at, open_play_session_id, customer_name, profiles(full_name, phone), customers(full_name, phone)";

/** Who a court booking is for, as staff call it. */
export const courtBookingName = (b: CourtBooking) =>
    b.open_play_session_id ? "Open play" : b.customer_name || b.customers?.full_name || b.profiles?.full_name || "Guest Player";

/** Today's bookings that hold a court (spot rows have no court), for each court's now / next line. */
export const fetchTodayCourtBookings = async () => {
    const { data, error } = await supabase
        .from("bookings")
        .select(COURT_BOOKING_COLUMNS)
        .eq("booking_date", formatManilaDate())
        .not("court_id", "is", null)
        .in("status", ["confirmed", "checked_in", "in_progress"]);
    if (error) console.error("Failed to fetch today's court bookings:", error);
    return { data: (data ?? []) as unknown as CourtBooking[], error };
};

/** Bookings from today on that still hold this court, including unpaid holds (callers drop expired ones). */
export const fetchUpcomingCourtBookings = async (courtId: string) => {
    const { data, error } = await supabase
        .from("bookings")
        .select(COURT_BOOKING_COLUMNS)
        .eq("court_id", courtId)
        .gte("booking_date", formatManilaDate())
        .in("status", ["pending", "confirmed", "checked_in", "in_progress"])
        .order("booking_date")
        .order("start_time");
    if (error) console.error("Failed to fetch upcoming court bookings:", error);
    return { data: (data ?? []) as unknown as CourtBooking[], error };
};
