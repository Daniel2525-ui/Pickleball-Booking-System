import { supabase } from "@/lib/supabase";
import { Booking, FetchBookingsFilters } from "./bookingsTypes";
import { checkoutTotal } from "./basket";

export const BOOKINGS_PAGE_SIZE = 100;

/**
 * PostgREST or() filter on bookings matching a staff search: player name, booking ref (bookingRef) or mobile number.
 */
export const bookingSearchFilter = async (search: string) => {
    const term = search.trim().replace(/[(),%]/g, " ").trim(); // characters that break the or() filter syntax
    const ors = [`customer_name.ilike.%${term}%`];
    // Booking ref (bookingRef): uuid columns can't ilike, so match the prefix as a range.
    // basket_id is the ref shown; id keeps per-court refs handed out before refs were per checkout working
    if (/^[0-9a-f]{6}$/i.test(term)) {
        const p = term.toLowerCase();
        for (const col of ["basket_id", "id"]) ors.push(`and(${col}.gte.${p}00-0000-0000-0000-000000000000,${col}.lte.${p}ff-ffff-ffff-ffff-ffffffffffff)`);
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
                payments(id, status, amount, payment_method, payment_reference, paid_at)
            `)
            .order("booking_date", { ascending: false })
            .order("start_time", { ascending: false })
            // Courts sharing a date and time need a fixed order, or "load more" repeats and skips rows
            .order("id")
            // A booking can have a later duplicate-charge payment row (20261102); keep the original first for payments[0]
            .order("created_at", { referencedTable: "payments", ascending: true })
            .range(offset, offset + BOOKINGS_PAGE_SIZE - 1)
            // Open play court-reserving rows (session set, no spots) are not bookings; staff manage them on Open Play
            .or("open_play_session_id.is.null,open_play_spots.not.is.null");

        if (hasStatusFilter && status.toLowerCase() === "expired") {
            query = query.eq("status", "cancelled").eq("cancel_reason", "expired");
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
        const baskets = new Map<string, { status: string; total_amount: number | null }[]>();
        if (basketIds.length) {
            const { data: rows, error: basketError } = await supabase.from("bookings").select("basket_id, status, total_amount").in("basket_id", basketIds);
            if (basketError) throw basketError;
            for (const r of rows ?? []) baskets.set(r.basket_id, [...(baskets.get(r.basket_id) ?? []), r]);
        }

        return {
            data: (data ?? []).map((b) => {
                const basket = b.basket_id ? baskets.get(b.basket_id) : undefined;
                return { ...b, basket_size: basket?.length ?? 1, basket_total: basket ? checkoutTotal(basket) : Number(b.total_amount ?? 0) };
            }) as Booking[],
            error: null,
        };
    } catch (error) {
        console.error("Failed to fetch bookings:", error);
        return { data: [], error };
    }
};
