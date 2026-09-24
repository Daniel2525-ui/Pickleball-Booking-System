import { supabase } from "@/lib/supabase";

export interface BookingSlot {
    court_id: string;
    start_time: string;
    end_time: string;
}

export const fetchBookingsForDate = async (date: Date | string) => {
    try {
        let dateStr = date;
        if (date instanceof Date) {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, "0");
            const day = String(date.getDate()).padStart(2, "0");
            dateStr = `${year}-${month}-${day}`;
        }
        
        const { data, error } = await supabase
            .from("bookings")
            .select("court_id, start_time, end_time")
            .eq("booking_date", dateStr)
            .eq("status", "confirmed");

        if (error) throw error;
        return { data: (data || []) as BookingSlot[], error: null };
    } catch (error) {
        console.error("Failed to fetch bookings for date:", error);
        return { data: [], error };
    }
};
