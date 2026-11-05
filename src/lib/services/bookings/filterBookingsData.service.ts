import { supabase } from "@/lib/supabase";
import { Booking, FetchBookingsFilters } from "./bookingsTypes";

export const BOOKINGS_PAGE_SIZE = 100;

/**
 * PostgREST or() filter on bookings matching a staff search: player name, booking ref (bookingRef) or mobile number.
 */
export const bookingSearchFilter = async (search: string) => {
    const term = search.trim().replace(/[(),%]/g, " ").trim(); // characters that break the or() filter syntax
    const ors = [`customer_name.ilike.%${term}%`];
    // Booking ref (bookingRef): uuid columns can't ilike, so match the id prefix as a range
    if (/^[0-9a-f]{6}$/i.test(term)) {
        const p = term.toLowerCase();
        ors.push(`and(id.gte.${p}00-0000-0000-0000-000000000000,id.lte.${p}ff-ffff-ffff-ffff-ffffffffffff)`);
    }
    // Mobile number: phones live on profiles (online) and customers (walk-ins), stored as 09xxxxxxxxx.
    // Matched as an ending (full number or last digits), so a network prefix like 0917 can't flood the id list.
    const digits = term.replace(/\D/g, "").replace(/^63(?=\d{10}$)/, "0"); // +63 917... → 0917...
    if (digits.length >= 4 && digits.length <= 11 && /^[\d\s+-]+$/.test(term)) {
        const [profiles, customers] = await Promise.all([
            supabase.from("profiles").select("id").ilike("phone", `%${digits}`).limit(100),
            supabase.from("customers").select("id").ilike("phone", `%${digits}`).limit(100),
        ]);
        if (profiles.error) throw profiles.error;
        if (customers.error) throw customers.error;
        if (profiles.data.length) ors.push(`user_id.in.(${profiles.data.map((r) => r.id).join(",")})`);
        if (customers.data.length) ors.push(`customer_id.in.(${customers.data.map((r) => r.id).join(",")})`);
    }
    return ors.join(",");
};

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
                profiles(full_name, phone),
                customers(full_name, phone, email),
                payments(id, status, amount, payment_method, payment_reference, paid_at, gcash_proof_path, gcash_submitted_at)
            `)
            .order("booking_date", { ascending: false })
            .order("start_time", { ascending: false })
            // A booking can have a later duplicate-charge payment row (20261102); keep the original first for payments[0]
            .order("created_at", { referencedTable: "payments", ascending: true })
            .range(offset, offset + BOOKINGS_PAGE_SIZE - 1)
            // Open play court-reserving rows (session set, no spots) are not bookings; staff manage them on Open Play
            .or("open_play_session_id.is.null,open_play_spots.not.is.null");

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
            query = query.or(await bookingSearchFilter(search));
        }

        if (dateTime) {
            query = query.eq("booking_date", dateTime);
        }

        const { data, error } = await query;

        if (error) throw error;

        // Counted over every booking in the basket, so the court filter or paging can't shrink a group
        const basketIds = [...new Set((data ?? []).flatMap((b) => (b.basket_id ? [b.basket_id] : [])))];
        const sizes = new Map<string, number>();
        if (basketIds.length) {
            const { data: rows, error: basketError } = await supabase.from("bookings").select("basket_id").in("basket_id", basketIds);
            if (basketError) throw basketError;
            for (const r of rows ?? []) sizes.set(r.basket_id, (sizes.get(r.basket_id) ?? 0) + 1);
        }

        return { data: (data ?? []).map((b) => ({ ...b, basket_size: b.basket_id ? sizes.get(b.basket_id) ?? 1 : 1 })) as Booking[], error: null };
    } catch (error) {
        console.error("Failed to fetch bookings:", error);
        return { data: [], error };
    }
};

/** Bookings whose GCash screenshot was sent and still waits for staff (submit_gcash_proof sets an infinite hold). */
export const countAwaitingGcash = async () => {
    const { count, error } = await supabase
        .from("bookings")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending")
        .eq("hold_expires_at", "infinity");
    if (error) console.error("Failed to count GCash payments awaiting verification:", error);
    return count ?? 0;
};
