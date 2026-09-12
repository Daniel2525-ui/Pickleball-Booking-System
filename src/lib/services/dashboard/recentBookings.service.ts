import { supabase } from "@/lib/supabase";

export interface RecentBooking {
    id: string;
    customer: string;
    court: string;
    dateTime: string;
    amount: string;
    status: "Confirmed" | "Pending";
}

export const fetchRecentBookings = async () => {
    try {
        const { data, error } = await supabase
            .from("bookings")
            .select(`
                id,
                created_at,
                booking_date,
                start_time,
                total_amount,
                status,
                court_id,
                courts ( name ),
                profiles:user_id ( full_name )       
            `)
            .order("created_at", {
                ascending: false,
            })
            .limit(5);

        if (error) throw error;

        // Transform Supabase rows into the formatted RecentBooking interface
        const formattedBookings: RecentBooking[] = (data || []).map((booking: any) => {
            const customerName = Array.isArray(booking.profiles)
                ? booking.profiles[0]?.full_name
                : booking.profiles?.full_name || "Guest User";

            const courtName = Array.isArray(booking.courts)
                ? booking.courts[0]?.name
                : booking.courts?.name || "Court";

            const datePart = booking.booking_date
                ? new Date(booking.booking_date + "T00:00:00").toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                })
                : "";
            const timePart = booking.start_time ? booking.start_time.slice(0, 5) : "";
            const dateTimeStr = [datePart, timePart].filter(Boolean).join(" · ");

            const rawStatus = (booking.status || "").toLowerCase();
            const status: "Confirmed" | "Pending" =
                rawStatus === "confirmed" || rawStatus === "completed" ? "Confirmed" : "Pending";

            return {
                id: String(booking.id),
                customer: customerName,
                court: courtName,
                dateTime: dateTimeStr,
                amount: `₱${booking.total_amount ?? 0}`,
                status,
            };
        });

        return { data: formattedBookings, error: null };
    } catch (error) {
        console.error("Failed to fetch recent bookings", error);
        return { data: null, error };
    }
};
