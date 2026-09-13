import { supabase } from "@/lib/supabase";

export interface Booking {
    id: string;
    user_id: string;
    court_id: string;
    booking_date: string;
    start_time: string;
    end_time: string;
    status: string;
    total_amount: number;
    created_at: string;
    updated_at: string;
    // Joined fields from other tables
    profiles?: {
        full_name: string;
    };
    courts?: {
        name: string;
    };
}

export interface FetchBookingsFilters {
    search?: string;
    status?: string;
    courtId?: string;
}

export const fetchBookings = async (filters?: FetchBookingsFilters) => {
    try {
        // 1. Start base query with joins
        // We join profiles to get the customer name, and courts to get the court name
        let query = supabase
            .from("bookings")
            .select(`
                *,
                profiles (
                    full_name
                ),
                courts (
                    name
                )
            `)
            .order("booking_date", { ascending: false });

        // 2. Apply Filters if they exist
        if (filters) {
            // Filter by Status
            if (filters.status && filters.status !== "All Statuses") {
                query = query.eq("status", filters.status.toLowerCase());
            }

            // Filter by Court
            if (filters.courtId && filters.courtId !== "All Courts") {
                // Since the dropdown passes the court name, we filter on the joined table
                query = query.eq("courts.name", filters.courtId);
            }

            // Filter by Search (Customer Name)
            if (filters.search) {
                // Supabase allows filtering on joined tables like this:
                query = query.ilike("profiles.full_name", `%${filters.search}%`);
            }
        }

        // 3. Execute query
        const { data, error } = await query;

        if (error) throw error;

        return { data: (data || []) as Booking[], error: null };
    } catch (error) {
        console.error("Failed to fetch bookings:", error);
        return { data: [], error };
    }
};
