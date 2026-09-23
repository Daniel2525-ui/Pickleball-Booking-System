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

        const customers: Customer[] = (data || []).map((customer) => ({
            id: customer.id,
            name: customer.full_name,
            email: customer.email,
            phone: customer.phone,
            joinedAt: customer.created_at,
            totalBookings: 0
        }))

        return { data: customers, error: null }
    } catch (error) {
        console.error("Failed to fetch customer data", error)
        return { data: [], error }
    }

}