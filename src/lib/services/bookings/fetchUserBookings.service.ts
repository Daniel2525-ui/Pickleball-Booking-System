import { supabase } from "@/lib/supabase";

export interface UserBooking {
    id: string,
    court_id: string,
    booking_date: string,
    start_time: string,
    end_time: string,
    status: string,
    amount?: number,
    created_at: string,
    courts?: { name: string }
}

export const fetchUserBookings = async (userId: string) => {
    try {
        const { data, error } = await supabase
            .from("bookings")
            .select(`
                id,
                court_id,
                booking_date,
                start_time,
                end_time,
                status,
                amount,
                created_at,
                    courts (
                        name
                    )
                `)
            .eq("user_id", userId)
            .order("booking_date", { ascending: false })

        if (error) throw error;

        return { data: (data || []) as unknown as UserBooking[], error: null };
    } catch (error) {
        console.error("Failed to fetch user bookings:", error)
        return { data: [], error }
    }
}