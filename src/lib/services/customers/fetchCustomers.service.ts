import { Customer } from "./customersTypes";

export const fetchCustomers = async (limit: number = 100) => {
    try {
        const res = await fetch(`/api/admin/customers?limit=${limit}`);
        const body = await res.json().catch(() => null);

        if (!res.ok) {
            return { data: [], error: new Error(body?.error || "Failed to fetch customers.") };
        }

        return { data: (body.data || []) as Customer[], error: null };
    } catch (error) {
        console.error("Failed to fetch customer data", error);
        return { data: [], error: error as Error };
    }
};