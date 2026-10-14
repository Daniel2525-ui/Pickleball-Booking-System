import { supabase } from "@/lib/supabase";
import { Customer } from "./customersTypes";

export const fetchCustomers = async () => {

    try {
        const { data, error } = await supabase
            .from("profiles")
            .select(`
            id,
            full_name,
            email,
            phone,
            created_at
        `)
            .order("created_at", { ascending: false })

        if (error) throw error;

        return { data: (data || []) as Customer[], error: null }
    } catch (error) {
        console.error("Failed to fetch customer data", error)
        return { data: [], error }
    }

}