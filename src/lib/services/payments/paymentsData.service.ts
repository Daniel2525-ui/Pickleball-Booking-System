import { supabase } from "@/lib/supabase";
import { Payment, FetchPaymentsFilters } from "./paymentsTypes";

export const fetchPayments = async (filters?: FetchPaymentsFilters) => {
    try {
        let query = supabase
            .from("payments")
            .select(`
                *,
                bookings (
                    booking_date,
                    start_time,
                    end_time,
                    profiles (
                        full_name
                    ),
                    courts (
                        name
                    )
                )
            `)
            .order("created_at", { ascending: false });

        if (filters) {
            if (
                filters.status &&
                filters.status !== "All Statuses" &&
                filters.status.toLowerCase() !== "all" &&
                filters.status.trim() !== ""
            ) {
                query = query.eq("status", filters.status.toLowerCase());
            }
        }

        const { data, error } = await query;

        if (error) throw error;

        return { data: (data || []) as Payment[], error: null };
    } catch (error) {
        console.error("Failed to fetch payments:", error);
        return { data: [], error };
    }
};
