import { createClient } from "@/lib/supabase/client";

export interface UserBooking {
    id: string,
    court_id: string,
    booking_date: string,
    start_time: string,
    end_time: string,
    status: string,
    total_amount?: number,
    created_at: string,
    hold_expires_at?: string | null,
    cancel_reason?: string | null,
    basket_id?: string | null,
    open_play_spots?: number | null,
    courts?: { name: string } | null,
    payments?: { status: string, payment_method: string | null }[] | null,
    /** Latest refund request status for a cancelled booking (get_my_refund_states), when one exists */
    refund_status?: string | null
}

export const fetchUserBookings = async (userId: string) => {
    try {
        const supabase = createClient();
        const { data, error } = await supabase
            .from("bookings")
            .select(`
                id,
                court_id,
                booking_date,
                start_time,
                end_time,
                status,
                total_amount,
                created_at,
                hold_expires_at,
                cancel_reason,
                basket_id,
                open_play_spots,
                    courts (
                        name
                    ),
                    payments (
                        status,
                        payment_method
                    )
                `)
            .eq("user_id", userId)
            .order("booking_date", { ascending: false })
            .order("start_time", { ascending: false })
            // shortcut: newest 500 only (about 3 years at three games a week); the oldest checkout at the cut-off can show partly; add "load more" to Past when a player gets near it
            .limit(500);

        if (error) throw error;
        const bookings = (data || []) as unknown as UserBooking[];

        // Refund progress for cancelled bookings (pending at Stripe, failed, under review); best effort
        const cancelledIds = bookings.filter((b) => b.status === "cancelled").map((b) => b.id);
        if (cancelledIds.length) {
            const { data: states, error: stateError } = await supabase.rpc("get_my_refund_states", { p_booking_ids: cancelledIds });
            if (stateError) console.error("Failed to fetch refund states:", stateError);
            const byBooking = new Map(((states ?? []) as { booking_id: string; status: string }[]).map((s) => [s.booking_id, s.status]));
            for (const b of bookings) b.refund_status = byBooking.get(b.id) ?? null;
        }

        return { data: bookings, error: null };
    } catch (error) {
        console.error("Failed to fetch user bookings:", error)
        return { data: [], error }
    }
}