import { Customer, CreateWalkInCustomerInput } from "./customersTypes";

export const createWalkInCustomer = async (
    input: CreateWalkInCustomerInput
): Promise<{ data: Customer | null; error: Error | null }> => {
    try {
        const fullName = input.fullName?.trim();
        if (!fullName) {
            return { data: null, error: new Error("Full name is required for walk-in customer.") };
        }

        const phone = input.phone?.trim() || null;
        const email = input.email?.trim() || null;

        const res = await fetch("/api/admin/customers", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fullName, phone, email }),
        });

        const body = await res.json().catch(() => null);
        if (!res.ok) {
            return { data: null, error: new Error(body?.error || "Failed to create customer record.") };
        }

        return { data: body.data as Customer, error: null };
    } catch (error) {
        console.error("Failed to create walk-in customer:", error);
        return { data: null, error: error as Error };
    }
};
