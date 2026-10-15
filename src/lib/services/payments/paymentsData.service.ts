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

        if (filters?.status && filters.status !== "All Statuses" && filters.status.toLowerCase() !== "all" && filters.status.trim() !== "") {
            const status = filters.status.toLowerCase();
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
