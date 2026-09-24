import { supabase } from "@/lib/supabase";

export const createAdminBooking = async (
    user_id: string,
    court_id: string,
    booking_date: string,
    start_time: string,
    end_time: string,
    amount: number
) => {
    try {
        // Ensure time has seconds
        const startTimeDb = start_time.length === 5 ? `${start_time}:00` : start_time;
        const endTimeDb = end_time.length === 5 ? `${end_time}:00` : end_time;

        // Check for conflicts
        const { data: conflicts } = await supabase
            .from("bookings")
            .select("id")
            .eq("court_id", court_id)
            .eq("booking_date", booking_date)
            .eq("status", "confirmed")
            .lt("start_time", endTimeDb)
            .gt("end_time", startTimeDb);

        if (conflicts && conflicts.length > 0) {
            return { data: null, error: new Error("This time slot is no longer available.") };
        }

        // Create booking
        const { data: booking, error: bookingError } = await supabase
            .from("bookings")
            .insert({
                user_id,
                court_id,
                booking_date,
                start_time: startTimeDb,
                end_time: endTimeDb,
                status: "confirmed",
                total_amount: amount,
            })
            .select()
            .single();

        if (bookingError) throw bookingError;

        // Create payment
        const { error: paymentError } = await supabase
            .from("payments")
            .insert({
                booking_id: booking.id,
                amount,
                currency: "php",
                status: "succeeded",
                paid_at: new Date().toISOString()
            });

        if (paymentError) {
            // Clean up if payment fails
            await supabase.from("bookings").delete().eq("id", booking.id);
            throw paymentError;
        }

        return { data: booking, error: null };
    } catch (error) {
        console.error("Failed to create admin booking", error);
        return { data: null, error: error as Error };
    }
};
