import { supabase } from "@/lib/supabase";

export interface SettleCounterPaymentParams {
    paymentId: string;
    bookingId: string;
    paymentMethod: "cash" | "gcash";
    paymentReference?: string;
}

export const settleCounterPayment = async ({
    paymentId,
    bookingId,
    paymentMethod,
    paymentReference,
}: SettleCounterPaymentParams): Promise<{ success: boolean; data: Record<string, unknown> | null; error: Error | null }> => {
    try {
        if (!paymentId || !bookingId || !paymentMethod) {
            return {
                success: false,
                data: null,
                error: new Error("Missing required payment settlement parameters."),
            };
        }

        const { data, error } = await supabase
            .from("payments")
            .update({
                status: "paid",
                payment_method: paymentMethod,
                payment_reference: paymentReference?.trim() || null,
                paid_at: new Date().toISOString(),
            })
            .eq("id", paymentId)
            .eq("booking_id", bookingId)
            .eq("status", "pending")
            .select()
            .single();

        if (error) throw error;

        if (!data) {
            return {
                success: false,
                data: null,
                error: new Error("Payment is no longer pending or has already been settled."),
            };
        }

        // Confirm the booking row so it won't be cancelled by the cleanup cron
        await supabase
            .from("bookings")
            .update({ status: "confirmed" })
            .eq("id", bookingId)
            .eq("status", "pending");

        return { success: true, data: data as Record<string, unknown>, error: null };
    } catch (error: unknown) {
        console.error("Failed to settle counter payment:", error);
        return { success: false, data: null, error: error as Error };
    }
};
