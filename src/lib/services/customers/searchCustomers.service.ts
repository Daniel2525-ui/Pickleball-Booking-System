import { UnifiedCustomerResult } from "./customersTypes";

export const searchCustomers = async (
    queryText: string = ""
): Promise<{ data: UnifiedCustomerResult[]; error: Error | null }> => {
    try {
        const sanitizedQuery = queryText.replace(/[(),%.,]/g, " ").trim();
        const limit = sanitizedQuery ? 15 : 10;
        const res = await fetch(`/api/admin/customers?search=${encodeURIComponent(sanitizedQuery)}&limit=${limit}`);
        const body = await res.json().catch(() => null);

        if (!res.ok) {
            return { data: [], error: new Error(body?.error || "Failed to search customers.") };
        }

        const data: UnifiedCustomerResult[] = (body?.data || []).map(
            (c: { id: string; full_name: string; email?: string | null; phone?: string | null; type?: "registered" | "walk_in" }) => ({
                id: c.id,
                full_name: c.full_name,
                email: c.email || null,
                phone: c.phone || null,
                type: c.type || "walk_in",
            })
        );

        return { data, error: null };
    } catch (error) {
        console.error("Failed to search customers:", error);
        return { data: [], error: error as Error };
    }
};
