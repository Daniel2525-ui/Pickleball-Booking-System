import { supabase } from "@/lib/supabase";
import { Payment, FetchPaymentsFilters, sumPayments, venueDayWindow, DONE_REFUND_STATUSES } from "./paymentsTypes";
import { bookingSearchFilter } from "@/lib/services/bookings/filterBookingsData.service";
import { fetchBookingPolicy } from "@/lib/services/settings/bookingPolicy";

export const PAYMENTS_PAGE_SIZE = 100;

// Pay-at-counter money: a pending payment on a booking that is going ahead. Online holds stay 'pending' bookings
const COLLECTABLE_BOOKING_STATUSES = ["confirmed", "checked_in", "completed"];
// A cancelled booking still owes its refund unless staff kept the payment (cancel_reason 'payment_kept')
const NOT_KEPT = "cancel_reason.is.null,cancel_reason.neq.payment_kept";

export const fetchPayments = async (filters?: FetchPaymentsFilters, offset = 0) => {
    try {
        const status = filters?.status?.trim().toLowerCase() ?? "";
        const toCollect = status === "to collect";
        const refundOwed = status === "refund owed";

        let query = supabase
            .from("payments")
            .select(`
                *,
                refund_requests ( status, created_at ),
                bookings${toCollect || refundOwed ? "!inner" : ""} (
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

        if (toCollect) {
            query = query.eq("status", "pending").in("bookings.status", COLLECTABLE_BOOKING_STATUSES);
        } else if (refundOwed) {
            query = query.eq("status", "paid").eq("bookings.status", "cancelled").or(NOT_KEPT, { referencedTable: "bookings" });
        } else if (status !== "" && status !== "all statuses" && status !== "all") {
            query = query.eq("status", status);
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

/** The business day's window: money taken after midnight, before the cutoff, belongs to the night before */
const dayWindow = async (date: string) => venueDayWindow(date, (await fetchBookingPolicy(supabase)).dayEndsAt);

/** Refunds completed in this window, with their payment's method (cash or not decides the drawer). */
const refundsIn = ({ start, end }: { start: string; end: string }) =>
    supabase
        .from("refund_requests")
        .select("payment_id, amount, payments(payment_method)")
        .in("status", DONE_REFUND_STATUSES)
        .gte("processed_at", start)
        .lt("processed_at", end);

/** Payments touching this venue day: paid then, created then and not paid yet, or refunded then. */
const dayFilter = async (date: string) => {
    const window = await dayWindow(date);
    const { start, end } = window;
    const { data: refunds, error } = await refundsIn(window);
    if (error) throw error;
    const refunded = [...new Set((refunds ?? []).map((r) => r.payment_id))];
    return [
        `and(paid_at.gte."${start}",paid_at.lt."${end}")`,
        `and(paid_at.is.null,created_at.gte."${start}",created_at.lt."${end}")`,
        ...(refunded.length ? [`id.in.(${refunded.join(",")})`] : []),
    ].join(",");
};

/** The day's money in (by method, counted when paid) and refunds (counted when returned), independent of paging and search. */
export const fetchPaymentTotals = async (date: string) => {
    const window = await dayWindow(date);
    const [paid, refunds] = await Promise.all([
        supabase.from("payments").select("status, amount, payment_method").in("status", ["paid", "refunded"])
            .gte("paid_at", window.start).lt("paid_at", window.end),
        refundsIn(window),
    ]);
    const error = paid.error || refunds.error;
    if (error) console.error("Failed to load payment totals:", error);
    // One payment per refund (payment_id is a foreign key), so the embed is an object
    const refundRows = (refunds.data ?? []).map((r) => ({ amount: r.amount, payment_method: (r.payments as { payment_method?: string | null } | null)?.payment_method }));
    return { data: error ? null : sumPayments(paid.data ?? [], refundRows), error };
};

/** Number of payments still held for a booking that was cancelled without keeping the money. */
export const countRefundOwed = async () => {
    const { count, error } = await supabase
        .from("payments")
        .select("id, bookings!inner(status, cancel_reason)", { count: "exact", head: true })
        .eq("status", "paid")
        .eq("bookings.status", "cancelled")
        .or(NOT_KEPT, { referencedTable: "bookings" });
    if (error) console.error("Failed to count refunds owed:", error);
    return count ?? 0;
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
