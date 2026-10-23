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

        // Check for conflicts against all active holding statuses
        const { data: conflicts, error: conflictErr } = await supabase
            .from("bookings")
            .select("id")
            .eq("court_id", courtId)
            .eq("booking_date", bookingDate)
            .in("status", ["confirmed", "checked_in", "in_progress", "completed", "pending"])
            .lt("start_time", endTimeDb)
            .gt("end_time", startTimeDb);

        if (conflictErr) throw conflictErr;

        if (conflicts && conflicts.length > 0) {
            return { bookingId: null, error: new Error("This court slot is no longer available. Please choose another time or court.") };
        }

        const methodParam = paymentMethod === "unpaid" ? null : paymentMethod;

        // If walk-in customer, use the database RPC which enforces court locking
        if (customerId) {
            const { data: rpcResult, error: rpcError } = await supabase.rpc("create_walk_in_booking", {
                p_court_id: courtId,
                p_customer_id: customerId,
                p_customer_name: trimmedName,
                p_booking_date: bookingDate,
                p_start_time: startTimeDb,
                p_end_time: endTimeDb,
                p_amount: amount,
                p_payment_method: methodParam,
            });

            if (rpcError) throw rpcError;

            const bookingId = (rpcResult as any)?.booking_id;

            if (bookingId && paymentReference?.trim()) {
                await supabase
                    .from("payments")
                    .update({ payment_reference: paymentReference.trim() })
                    .eq("booking_id", bookingId);
            }

            return { bookingId, error: null };
        }

        // If registered member, perform direct atomic insert
        const { data: booking, error: bookingError } = await supabase
            .from("bookings")
            .insert({
                user_id: userId,
                customer_id: null,
                customer_name: trimmedName,
                court_id: courtId,
                booking_date: bookingDate,
                start_time: startTimeDb,
                end_time: endTimeDb,
                status: "confirmed",
                total_amount: amount,
            })
            .select("id")
            .single();

        if (bookingError || !booking) throw bookingError || new Error("Failed to insert booking");

        const paymentStatus = methodParam ? "paid" : "pending";
        const { error: paymentError } = await supabase
            .from("payments")
            .insert({
                booking_id: booking.id,
                amount,
                currency: "php",
                status: paymentStatus,
                payment_method: methodParam,
                payment_reference: paymentReference?.trim() || null,
                paid_at: paymentStatus === "paid" ? new Date().toISOString() : null,
            });

        if (paymentError) {
            // Clean up booking if payment row creation fails
            await supabase.from("bookings").delete().eq("id", booking.id);
            throw paymentError;
        }

        return { bookingId: booking.id, error: null };
    } catch (error: any) {
        console.error("Failed to create walk-in booking:", error);
        return { bookingId: null, error: error as Error };
    }
};
