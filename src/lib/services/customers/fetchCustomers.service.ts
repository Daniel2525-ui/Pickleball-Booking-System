import { Customer } from "./customersTypes";

export const CUSTOMERS_PAGE_SIZE = 100;

/** One page of the customer directory, searched on the server, with the real totals. */
export const fetchCustomers = async (search = "", offset = 0) => {
    try {
        const params = new URLSearchParams({ limit: String(CUSTOMERS_PAGE_SIZE), offset: String(offset) });
        if (search.trim()) params.set("search", search.trim());
        const res = await fetch(`/api/admin/customers?${params}`);
        const body = await res.json().catch(() => null);

        if (!res.ok) {
            return { data: [] as Customer[], total: 0, newThisMonth: 0, error: new Error(body?.error || "Failed to fetch customers.") };
        }

        return { data: (body.data || []) as Customer[], total: body.total ?? 0, newThisMonth: body.newThisMonth ?? 0, error: null };
    } catch (error) {
        console.error("Failed to fetch customer data", error);
        return { data: [] as Customer[], total: 0, newThisMonth: 0, error: error as Error };
    }
};

/** Corrects a walk-in record's name, phone or email. */
export const updateWalkInCustomer = async (id: string, fields: { fullName: string; phone: string; email: string }) => {
    try {
        const res = await fetch("/api/admin/customers", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, ...fields }),
        });
        const body = await res.json().catch(() => null);
        return res.ok ? { error: null } : { error: new Error(body?.error || "Could not save the changes.") };
    } catch {
        return { error: new Error("Could not reach the server. Check your connection and try again.") };
    }
};

/** Sets the staff note on a customer; an empty note clears it. */
export const saveCustomerNote = async (id: string, note: string) => {
    try {
        const res = await fetch("/api/admin/customers", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, note }),
        });
        const body = await res.json().catch(() => null);
        return res.ok ? { error: null } : { error: new Error(body?.error || "Could not save the note.") };
    } catch {
        return { error: new Error("Could not reach the server. Check your connection and try again.") };
    }
};
