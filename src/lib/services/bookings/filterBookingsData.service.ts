import { supabase } from "@/lib/supabase";
import { Booking, FetchBookingsFilters } from "./bookingsTypes";

export const fetchBookings = async (filters?: FetchBookingsFilters) => {
    try {
        const courtId = filters?.courtId?.trim() ?? "";
        const status = filters?.status?.trim() ?? "";
        const search = filters?.search?.trim() ?? "";
        const dateTime = filters?.dateTime?.trim() ?? "";

        const hasCourtFilter =
            courtId !== "" &&
            !["all courts", "all"].includes(courtId.toLowerCase());

        const hasStatusFilter =
            status !== "" &&
            !["all statuses", "all"].includes(status.toLowerCase());

        const isCourtUuid =
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(courtId);

        const profilesJoin = search
            ? "profiles!inner(full_name)"
            : "profiles(full_name)";

        const courtsJoin =
            hasCourtFilter && !isCourtUuid
                ? "courts!inner(name)"
                : "courts(name)";

        let query = supabase
            .from("bookings")
            .select(`*, ${profilesJoin}, ${courtsJoin}`)
            .order("booking_date", { ascending: false });

        if (hasStatusFilter) {
            query = query.eq("status", status.toLowerCase());
        }

        if (hasCourtFilter) {
            query = isCourtUuid
                ? query.eq("court_id", courtId)
                : query.ilike("courts.name", courtId);
        }

        if (search) {
            query = query.ilike("profiles.full_name", `%${search}%`);
        }

        if (dateTime) {
            query = query.eq("booking_date", dateTime);
        }

        const { data, error } = await query;

        if (error) throw error;

        return { data: (data ?? []) as Booking[], error: null };
    } catch (error) {
        console.error("Failed to fetch bookings:", error);
        return { data: [], error };
    }
};
