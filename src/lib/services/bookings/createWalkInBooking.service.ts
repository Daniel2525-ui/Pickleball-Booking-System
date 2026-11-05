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

/** Staff wording for the refusals create_walk_in_booking raises; null for anything else. */
export const walkInErrorMessage = (message: string | undefined): string | null => {
    const msg = message ?? "";
    if (msg.includes("PAST_SLOT")) return "That slot ended on an earlier day. Walk-ins can only be recorded for today or later.";
    if (msg.includes("INVALID_AMOUNT")) return "The fee no longer matches the price list. Close this form and open it again to refresh the price.";
    if (msg.includes("OUTSIDE_OPERATING_HOURS")) return "That time is outside the venue's opening hours for this day.";
    if (msg.includes("VENUE_CLOSED")) return "The venue is closed on that day.";
    if (msg.includes("COURT_UNAVAILABLE")) return "That court is closed for maintenance.";
    if (msg.includes("INVALID_DURATION")) return msg.replace(/^.*INVALID_DURATION:\s*/, "");
    if (msg.includes("INVALID_TIME_INCREMENT")) return "Bookings start and end on the hour, like 6:00 PM to 7:00 PM.";
    if (msg.includes("INVALID_TIME_RANGE")) return "The end time must be after the start time.";
    return null;
};

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

        // P0001 also covers VENUE_CLOSED / COURT_UNAVAILABLE, so match the message only
        if (rpcError?.message?.includes("SLOT_UNAVAILABLE")) {
            return { bookingId: null, error: new Error("This court slot is no longer available. Please choose another time or court.") };
        }
        const plain = walkInErrorMessage(rpcError?.message);
        if (plain) return { bookingId: null, error: new Error(plain) };


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
