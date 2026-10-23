import { supabase } from "@/lib/supabase";
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

        const { data, error } = await supabase
            .from("customers")
            .insert({
                full_name: fullName,
                phone,
                email,
            })
            .select()
            .single();

        if (error) throw error;

        return { data: data as Customer, error: null };
    } catch (error) {
        console.error("Failed to create walk-in customer:", error);
        return { data: null, error: error as Error };
    }
};
