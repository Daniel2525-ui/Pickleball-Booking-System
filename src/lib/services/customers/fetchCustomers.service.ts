import { supabase } from "@/lib/supabase";
import { Customer } from "./customersTypes";

export const fetchCustomers = async () => {
    try {
        const [profilesRes, customersRes] = await Promise.all([
            supabase
                .from("profiles")
                .select("id, full_name, email, phone, created_at")
                .order("created_at", { ascending: false }),
            supabase
                .from("customers")
                .select("id, full_name, email, phone, created_at")
                .order("created_at", { ascending: false }),
        ]);

        if (profilesRes.error) throw profilesRes.error;

        const profilesList = (profilesRes.data || []) as Customer[];
        const customersList = (customersRes.data || []) as Customer[];

        const combined = [...profilesList, ...customersList].sort((a, b) => {
            const dateA = new Date(a.created_at || 0).getTime();
            const dateB = new Date(b.created_at || 0).getTime();
            return dateB - dateA;
        });

        return { data: combined, error: null };
    } catch (error) {
        console.error("Failed to fetch customer data", error);
        return { data: [], error: error as Error };
    }
};