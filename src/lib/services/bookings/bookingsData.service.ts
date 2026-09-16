import { supabase } from "@/lib/supabase";
import { Booking, FetchBookingsFilters } from "./bookingsTypes";

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
            if (
                filters.status &&
                filters.status !== "All Statuses" &&
                filters.status.toLowerCase() !== "all" &&
                filters.status.trim() !== ""
            ) {
                query = query.eq("status", filters.status.toLowerCase());
            }

            // Filter by Court
            if (
                filters.courtId &&
                filters.courtId !== "All Courts" &&
                filters.courtId.toLowerCase() !== "all" &&
                filters.courtId.trim() !== ""
            ) {
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
