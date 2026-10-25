
import { supabase } from "@/lib/supabase";

export interface BookingSlot {
    id: string;
    user_id?: string;
    court_id: string;
    start_time: string;
    end_time: string;
    status?: string;
}

export const fetchBookingsForDate = async (date: Date | string) => {
    try {
        const dateStr =
            date instanceof Date
                ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(date)
                : date;

        const { data, error } = await supabase
            .from("bookings")
            .select("id, user_id, court_id, start_time, end_time, status")
            .eq("booking_date", dateStr)
            .in("status", ["confirmed", "completed", "checked_in", "in_progress", "pending"]);

        if (error) throw error;

        return { data: (data || []) as BookingSlot[], error: null };
    } catch (error) {
        console.error("Failed to fetch bookings for date:", error);
        return { data: [], error };
    }
};
