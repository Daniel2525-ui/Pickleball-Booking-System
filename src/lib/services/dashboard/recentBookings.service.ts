import { supabase } from "@/lib/supabase";
import { formatTime12h } from "@/lib/utils/formatTime";
import { RecentBooking } from "./dashboardTypes";

export const fetchRecentBookings = async () => {

    try {
        const { data, error } = await supabase
            .from("bookings")
            .select(`
                id,
                created_at,
                booking_date,
                start_time,
                end_time,
                total_amount,
                status,
                court_id,
                customer_name,
                courts ( name ),
                profiles:user_id ( full_name )       
            `)
            .in("status", ["confirmed", "completed", "cancelled", "checked_in", "in_progress", "pending"])
            // Timed-out holds are noise here; they stay listed under Bookings > Expired Holds
            .or("cancel_reason.is.null,cancel_reason.neq.expired")
            .order("created_at", {
                ascending: false,
            })
            .limit(5);

        if (error) throw error;

        interface RawRecentBooking {
            id: string | number;
            created_at?: string;
            booking_date?: string;
            start_time: string;
            end_time: string;
            total_amount?: number;
            status?: string;
            customer_name?: string;
            courts?: { name?: string };
            profiles?: { full_name?: string };
        }

        const formattedBookings: RecentBooking[] = ((data || []) as unknown as RawRecentBooking[]).map((booking) => {
            const customerName = booking.profiles?.full_name || booking.customer_name || "Guest User";
            const courtName = booking.courts?.name || "Court";

            const datePart = booking.booking_date
                ? new Date(booking.booking_date + "T00:00:00").toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                })
                : "";

            const rawStatus = (booking.status || "").toLowerCase();
            const status: "Confirmed" | "Pending" | "Cancelled" =
                rawStatus === "confirmed" || rawStatus === "completed" || rawStatus === "checked_in" || rawStatus === "in_progress"
                    ? "Confirmed"
                    : rawStatus === "cancelled"
                        ? "Cancelled"
                        : "Pending";

            const startTime = formatTime12h(booking.start_time);
            const endTime = formatTime12h(booking.end_time);
            const timeRange = [startTime, endTime].filter(Boolean).join(" - ");
            const dateTimeStr = [datePart, timeRange].filter(Boolean).join(" · ");

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
