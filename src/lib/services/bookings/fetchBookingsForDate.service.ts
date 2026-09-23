import { supabase } from "@/lib/supabase";

export interface BookingSlot {
    court_id: string;
    start_time: string;
    end_time: string;
}

export const fetchBookingsForDate = async (date: string) => {
    try {
        const { data, error } = await supabase
            .from("bookings")
            .select("court_id, start_time, end_time")
            .eq("booking_date", date)
            .eq("status", "confirmed");

        if (error) throw error;
        return { data: (data || []) as BookingSlot[], error: null };
    } catch (error) {
        console.error("Failed to fetch bookings for date:", error);
        return { data: [], error };
    }
};
