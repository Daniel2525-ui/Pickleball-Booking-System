import { supabase } from "@/lib/supabase";
import { Payment, FetchPaymentsFilters, sumPayments, venueDayWindow } from "./paymentsTypes";
import { bookingSearchFilter } from "@/lib/services/bookings/filterBookingsData.service";
import { fetchBookingPolicy } from "@/lib/services/settings/bookingPolicy";

export const PAYMENTS_PAGE_SIZE = 100;

// A cancelled booking whose payment staff chose to keep owes nothing back
const NOT_KEPT = "cancel_reason.is.null,cancel_reason.neq.payment_kept";

// Pay-at-counter money: a pending payment on a booking that is going ahead. Online holds stay 'pending' bookings
const COLLECTABLE_BOOKING_STATUSES = ["confirmed", "checked_in", "completed"];

export const fetchPayments = async (filters?: FetchPaymentsFilters, offset = 0) => {
    try {
        const status = filters?.status?.trim().toLowerCase() ?? "";
        // Paid payments on cancelled bookings are owed back to the customer
        const refundOwed = status === "refund owed";
        const toCollect = status === "to collect";

        let query = supabase
            .from("payments")
            .select(`
                *,
                refund_requests ( status, created_at ),
                bookings${refundOwed || toCollect ? "!inner" : ""} (
                    basket_id,
                    status,
                    cancel_reason,
                    booking_date,
                    start_time,
                    end_time,
                    customer_name,
                    open_play_spots,
                    court_id,
                    hold_expires_at,
                    created_at,
                    profiles (
                        full_name
                    ),
                    courts (
                        name
                    )
                )
            `)
            .order("created_at", { ascending: false })
            .range(offset, offset + PAYMENTS_PAGE_SIZE - 1);

        if (refundOwed) {
            query = query
                .in("status", ["succeeded", "paid"])
                .eq("bookings.status", "cancelled")
                .or(NOT_KEPT, { referencedTable: "bookings" });
        } else if (toCollect) {
            query = query.eq("status", "pending").in("bookings.status", COLLECTABLE_BOOKING_STATUSES);
        } else if (status !== "" && status !== "all statuses" && status !== "all") {
            if (status === "succeeded" || status === "paid") {
                query = query.in("status", ["succeeded", "paid"]);
            } else {
                query = query.eq("status", status);
            }
        } else {
            query = query.not("status", "eq", "failed");
        }

        if (filters?.date) query = query.or(await dayFilter(filters.date));

        const search = filters?.search?.trim() ?? "";
        if (search) {
            // Payer name, booking ref or phone (the Bookings search), or the reference on the payment itself
            // shortcut: matches at most 200 bookings per search, plenty for a name or ref; raise if a common name misses rows
            const { data: matches, error: matchError } = await supabase.from("bookings").select("id").or(await bookingSearchFilter(search)).limit(200);
            if (matchError) throw matchError;
            const term = search.replace(/[(),%"]/g, " ").trim();
            const ors = [`payment_reference.ilike.%${term}%`];
            if (matches?.length) ors.push(`booking_id.in.(${matches.map((b) => b.id).join(",")})`);
            query = query.or(ors.join(","));
        }

        const { data, error } = await query;

        if (error) throw error;

        return { data: (data || []) as Payment[], error: null };
    } catch (error) {
        console.error("Failed to fetch payments:", error);
        return { data: [], error };
    }
};

/** Payments whose money came in on this venue day: paid then, or created then and not paid yet. */
const dayFilter = async (date: string) => {
    // The business day: money taken after midnight, before the cutoff, belongs to the night before
    const { start, end } = venueDayWindow(date, (await fetchBookingPolicy(supabase)).dayEndsAt);
    return `and(paid_at.gte."${start}",paid_at.lt."${end}"),and(paid_at.is.null,created_at.gte."${start}",created_at.lt."${end}")`;
};

/** The day's collected (by method) and refunded totals, independent of paging and search. */
export const fetchPaymentTotals = async (date: string) => {
    const { data, error } = await supabase
        .from("payments")
        .select("status, amount, payment_method")
        .neq("status", "failed")
        .or(await dayFilter(date));
    if (error) console.error("Failed to load payment totals:", error);
    return { data: error ? null : sumPayments(data ?? []), error };
};

/** Number of pending payments staff still have to collect at the counter. */
export const countToCollect = async () => {
    const { count, error } = await supabase
        .from("payments")
        .select("id, bookings!inner(status)", { count: "exact", head: true })
        .eq("status", "pending")
        .in("bookings.status", COLLECTABLE_BOOKING_STATUSES);
    if (error) console.error("Failed to count payments to collect:", error);
    return count ?? 0;
};

/** Number of paid payments whose booking was cancelled, i.e. money owed back to customers. */
export const countRefundsOwed = async () => {
    const { count, error } = await supabase
        .from("payments")
        .select("id, bookings!inner(status, cancel_reason)", { count: "exact", head: true })
        .in("status", ["succeeded", "paid"])
        .eq("bookings.status", "cancelled")
        .or(NOT_KEPT, { referencedTable: "bookings" });
    if (error) console.error("Failed to count refunds owed:", error);
    return count ?? 0;
};
