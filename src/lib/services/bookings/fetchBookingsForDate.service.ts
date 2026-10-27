
import { supabase } from "@/lib/supabase";
import { formatManilaDate } from "@/lib/utils/bookingTime";

export interface BookingSlot {
    id: string;
    user_id?: string;
    court_id: string;
    start_time: string;
    end_time: string;
    status?: string;
    hold_expires_at?: string | null;
    created_at?: string;
}

export const fetchBookingsForDate = async (date: Date | string) => {
    try {
        const dateStr = formatManilaDate(date);

        const { data, error } = await supabase
            .from("bookings")
            .select("id, user_id, court_id, start_time, end_time, status, hold_expires_at, created_at")
            .eq("booking_date", dateStr)
            .in("status", ["confirmed", "completed", "checked_in", "in_progress", "pending"]);

        if (error) throw error;

        return { data: (data || []) as BookingSlot[], error: null };
    } catch (error) {
        console.error("Failed to fetch bookings for date:", error);
        return { data: [], error };
    }
};
