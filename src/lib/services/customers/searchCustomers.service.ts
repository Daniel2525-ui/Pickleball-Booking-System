import { supabase } from "@/lib/supabase";
import { UnifiedCustomerResult } from "./customersTypes";

export const searchCustomers = async (
    queryText: string = ""
): Promise<{ data: UnifiedCustomerResult[]; error: Error | null }> => {
    try {
        const sanitizedQuery = queryText.replace(/[(),%.,]/g, " ").trim();

        let profilesQuery = supabase
            .from("profiles")
            .select("id, full_name, email, phone")
            .order("full_name");

        let customersQuery = supabase
            .from("customers")
            .select("id, full_name, email, phone")
            .order("full_name");

        if (sanitizedQuery) {
            profilesQuery = profilesQuery.or(`full_name.ilike.%${sanitizedQuery}%,phone.ilike.%${sanitizedQuery}%`).limit(15);
            customersQuery = customersQuery.or(`full_name.ilike.%${sanitizedQuery}%,phone.ilike.%${sanitizedQuery}%`).limit(15);
        } else {
            profilesQuery = profilesQuery.limit(10);
            customersQuery = customersQuery.limit(10);
        }

        const [profilesRes, customersRes] = await Promise.all([
            profilesQuery,
            customersQuery,
        ]);

        if (profilesRes.error) throw profilesRes.error;
        if (customersRes.error) throw customersRes.error;

        const registered: UnifiedCustomerResult[] = (profilesRes.data || []).map((p) => ({
            id: p.id,
            full_name: p.full_name,
            email: p.email,
            phone: p.phone,
            type: "registered" as const,
        }));

        const walkIns: UnifiedCustomerResult[] = (customersRes.data || []).map((c) => ({
            id: c.id,
            full_name: c.full_name,
            email: c.email,
            phone: c.phone,
            type: "walk_in" as const,
        }));

        return { data: [...registered, ...walkIns], error: null };
    } catch (error) {
        console.error("Failed to search customers:", error);
        return { data: [], error: error as Error };
    }
};
