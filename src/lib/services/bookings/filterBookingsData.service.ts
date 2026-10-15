import { supabase } from "@/lib/supabase";
import { Booking, FetchBookingsFilters } from "./bookingsTypes";

export const fetchBookings = async (filters?: FetchBookingsFilters) => {
    try {
        const hasCourtFilter = Boolean(
            filters?.courtId &&
            filters.courtId !== "All Courts" &&
            filters.courtId.toLowerCase() !== "all" &&
            filters.courtId.trim() !== ""
        );

        const hasSearchFilter = Boolean(filters?.search?.trim());
        const isCourtUuid =
            hasCourtFilter &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                filters!.courtId!.trim()
            );

        const profilesJoin = hasSearchFilter ? "profiles!inner(full_name)" : "profiles(full_name)";
        const courtsJoin = (!isCourtUuid && hasCourtFilter) ? "courts!inner(name)" : "courts(name)";

        let query = supabase
            .from("bookings")
            .select(`
                *,
                ${profilesJoin},
                ${courtsJoin}
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
            if (hasCourtFilter) {
                if (isCourtUuid) {
                    // Direct column match on bookings.court_id
                    query = query.eq("court_id", filters.courtId!.trim());
                } else {
                    // Fallback if court name is passed
                    query = query.ilike("courts.name", filters.courtId!.trim());
                }
            }

            // Filter by Search (Customer Name)
            if (hasSearchFilter) {
                query = query.ilike("profiles.full_name", `%${filters.search!.trim()}%`);
            }

            // Filter by Date
            if (filters.dateTime && filters.dateTime.trim() !== "") {
                query = query.eq("booking_date", filters.dateTime.trim());
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
