import { supabase } from "@/lib/supabase";

export interface CreateWalkInBookingParams {
    customerId?: string | null;
    userId?: string | null;
    customerName: string;
    courtId: string;
    bookingDate: string;
    startTime: string;
    endTime: string;
    amount: number;
    paymentMethod: "cash" | "gcash" | "unpaid";
    paymentReference?: string;
}

export const createWalkInBooking = async (
    params: CreateWalkInBookingParams
): Promise<{ bookingId: string | null; error: Error | null }> => {
    try {
        const {
            customerId,
            userId,
            customerName,
            courtId,
            bookingDate,
            startTime,
            endTime,
            amount,
            paymentMethod,
            paymentReference,
        } = params;

        if (!courtId || !bookingDate || !startTime || !endTime || !amount) {
            return { bookingId: null, error: new Error("Missing required booking details.") };
        }

        if (!customerId && !userId) {
            return { bookingId: null, error: new Error("Please select or create a player for this reservation.") };
        }

        const trimmedName = customerName?.trim();
        if (!trimmedName) {
            return { bookingId: null, error: new Error("Player name is required.") };
        }

        const startTimeDb = startTime.length === 5 ? `${startTime}:00` : startTime;
        const endTimeDb = endTime.length === 5 ? `${endTime}:00` : endTime;

        const methodParam = paymentMethod === "unpaid" ? null : paymentMethod;

        // 1. Try calling the unified court-locking RPC first (serializes on courts row for both guest & member)
        const { data: rpcResult, error: rpcError } = await supabase.rpc("create_walk_in_booking", {
            p_court_id: courtId,
            p_customer_name: trimmedName,
            p_booking_date: bookingDate,
            p_start_time: startTimeDb,
            p_end_time: endTimeDb,
            p_amount: amount,
            p_customer_id: customerId || null,
            p_user_id: userId || null,
            p_payment_method: methodParam,
            p_payment_reference: paymentReference?.trim() || null,
        });

        if (!rpcError && rpcResult) {
            const bookingId = (rpcResult as { booking_id?: string } | null)?.booking_id ?? null;
            return { bookingId, error: null };
        }

        if (rpcError && (rpcError.message?.includes("SLOT_UNAVAILABLE") || rpcError.code === "P0001")) {
            return { bookingId: null, error: new Error("This court slot is no longer available. Please choose another time or court.") };
        }


        // 3. If RPC is unavailable, fail safely rather than creating un-locked reservations
        console.error("Database concurrency lock (create_walk_in_booking) failed:", rpcError);
        return {
            bookingId: null,
            error: new Error(
                rpcError?.message || "Database concurrency lock (create_walk_in_booking) is not configured. Please ensure database migrations are applied."
            ),
        };
    } catch (error: unknown) {
        console.error("Failed to create walk-in booking:", error);
        return { bookingId: null, error: error as Error };
    }
};
