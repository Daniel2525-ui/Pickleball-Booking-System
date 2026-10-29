import { createClient } from "@/lib/supabase/client";

export interface UserBooking {
    id: string,
    court_id: string,
    booking_date: string,
    start_time: string,
    end_time: string,
    status: string,
    total_amount?: number,
    created_at: string,
    hold_expires_at?: string | null,
    cancel_reason?: string | null,
    courts?: { name: string }
}

export const fetchUserBookings = async (userId: string) => {
    try {
        const supabase = createClient();
        const { data, error } = await supabase
            .from("bookings")
            .select(`
                id,
                court_id,
                booking_date,
                start_time,
                end_time,
                status,
                total_amount,
                created_at,
                hold_expires_at,
                cancel_reason,
                    courts (
                        name
                    )
                `)
            .eq("user_id", userId)
            .order("booking_date", { ascending: false })
            .order("start_time", { ascending: false })
            .limit(100);

        if (error) throw error;

        return { data: (data || []) as unknown as UserBooking[], error: null };
    } catch (error) {
        console.error("Failed to fetch user bookings:", error)
        return { data: [], error }
    }
}