import { supabase } from "@/lib/supabase";
import { Payment, FetchPaymentsFilters } from "./paymentsTypes";

export const PAYMENTS_PAGE_SIZE = 100;

export const fetchPayments = async (filters?: FetchPaymentsFilters, offset = 0) => {
    try {
        const status = filters?.status?.trim().toLowerCase() ?? "";
        // Paid payments on cancelled bookings are owed back to the customer
        const refundOwed = status === "refund owed";

        let query = supabase
            .from("payments")
            .select(`
                *,
                refund_requests ( status, created_at ),
                bookings${refundOwed ? "!inner" : ""} (
                    status,
                    booking_date,
                    start_time,
                    end_time,
                    customer_name,
                    open_play_spots,
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
            query = query.in("status", ["succeeded", "paid"]).eq("bookings.status", "cancelled");
        } else if (status !== "" && status !== "all statuses" && status !== "all") {
            if (status === "succeeded" || status === "paid") {
                query = query.in("status", ["succeeded", "paid"]);
            } else {
                query = query.eq("status", status);
            }
        } else {
            query = query.not("status", "eq", "failed");
        }

        const { data, error } = await query;

        if (error) throw error;

        return { data: (data || []) as Payment[], error: null };
    } catch (error) {
        console.error("Failed to fetch payments:", error);
        return { data: [], error };
    }
};

/** Number of paid payments whose booking was cancelled, i.e. money owed back to customers. */
export const countRefundsOwed = async () => {
    const { count, error } = await supabase
        .from("payments")
        .select("id, bookings!inner(status)", { count: "exact", head: true })
        .in("status", ["succeeded", "paid"])
        .eq("bookings.status", "cancelled");
    if (error) console.error("Failed to count refunds owed:", error);
    return count ?? 0;
};
