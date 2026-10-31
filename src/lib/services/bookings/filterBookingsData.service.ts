import { supabase } from "@/lib/supabase";
import { Booking, FetchBookingsFilters } from "./bookingsTypes";

export const BOOKINGS_PAGE_SIZE = 100;

export const fetchBookings = async (filters?: FetchBookingsFilters, offset = 0) => {
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

        const courtsJoin =
            hasCourtFilter && !isCourtUuid
                ? "courts!inner(name)"
                : "courts(name)";

        let query = supabase
            .from("bookings")
            .select(`
                *,
                ${courtsJoin},
                profiles(full_name),
                customers(full_name, phone, email),
                payments(id, status, amount, payment_method, payment_reference, paid_at, gcash_proof_path, gcash_submitted_at)
            `)
            .order("booking_date", { ascending: false })
            .order("start_time", { ascending: false })
            // A booking can have a later duplicate-charge payment row (20261102); keep the original first for payments[0]
            .order("created_at", { referencedTable: "payments", ascending: true })
            .range(offset, offset + BOOKINGS_PAGE_SIZE - 1);

        if (hasStatusFilter && status.toLowerCase() === "expired") {
            query = query.eq("status", "cancelled").eq("cancel_reason", "expired");
        } else if (hasStatusFilter && status.toLowerCase() === "awaiting verification") {
            // Same two conditions as isAwaitingVerification
            query = query.eq("status", "pending").eq("hold_expires_at", "infinity");
        } else {
            if (hasStatusFilter) {
                // Labels such as "Checked In" / "No-Show" map to stored values checked_in / no_show
                query = query.eq("status", status.toLowerCase().replace(/[\s-]+/g, "_"));
            }
            // Timed-out holds are kept for history but only listed under the "Expired" filter
            query = query.or("cancel_reason.is.null,cancel_reason.neq.expired");
        }

        if (hasCourtFilter) {
            query = isCourtUuid
                ? query.eq("court_id", courtId)
                : query.ilike("courts.name", courtId);
        }

        if (search) {
            query = query.ilike("customer_name", `%${search}%`);
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
