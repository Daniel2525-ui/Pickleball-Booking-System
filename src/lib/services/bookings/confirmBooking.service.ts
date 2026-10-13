import { supabase } from "@/lib/supabase";
import { Booking } from "./bookingsTypes";

export const confirmBooking = async (id: string) => {
    try {
        // 1. Fetch the target booking to verify it exists and is pending
        const { data: booking, error: fetchError } = await supabase
            .from("bookings")
            .select("id, court_id, booking_date, start_time, end_time, status")
            .eq("id", id)
            .single();

        if (fetchError || !booking) {
            return { data: null, error: fetchError || new Error("Booking not found.") };
        }

        if (booking.status?.toLowerCase() !== "pending") {
            return {
                data: null,
                error: new Error(`Only pending bookings can be confirmed. Current status: ${booking.status}`),
            };
        }

        // 2. Validate court availability against any overlapping active bookings
        const { data: conflicts, error: conflictError } = await supabase
            .from("bookings")
            .select("id")
            .eq("court_id", booking.court_id)
            .eq("booking_date", booking.booking_date)
            .in("status", ["confirmed", "completed", "ongoing"])
            .neq("id", booking.id)
            .lt("start_time", booking.end_time)
            .gt("end_time", booking.start_time);

        if (conflictError) {
            return { data: null, error: conflictError };
        }

        if (conflicts && conflicts.length > 0) {
            return {
                data: null,
                error: new Error("Cannot confirm booking: This court has an overlapping confirmed reservation."),
            };
        }

        // 3. Update the booking status to confirmed
        const { data: updatedBooking, error: updateError } = await supabase
            .from("bookings")
            .update({ status: "confirmed" })
            .eq("id", id)
            .eq("status", "pending")
            .select()
            .single();

        if (updateError) throw updateError;

        if (!updatedBooking) {
            return {
                data: null,
                error: new Error("No rows were updated. The booking may no longer be pending."),
            };
        }

        // 4. Update any associated pending payment record to paid
        await supabase
            .from("payments")
            .update({
                status: "paid",
                paid_at: new Date().toISOString(),
            })
            .eq("booking_id", id)
            .eq("status", "pending");

        return { data: updatedBooking as Booking, error: null };
    } catch (error) {
        console.error("Failed to confirm booking:", error);
        return { data: null, error: error as Error };
    }
};
