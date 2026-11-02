
import { supabase } from "@/lib/supabase";
import { formatManilaDate } from "@/lib/utils/bookingTime";

export interface BookingSlot {
    /** Null for other players' bookings (masked by get_public_slot_availability). */
    id: string | null;
    user_id?: string | null;
    court_id: string;
    start_time: string;
    end_time: string;
    status?: string;
    hold_expires_at?: string | null;
    created_at?: string;
    open_play?: boolean;
}

export const fetchBookingsForDate = async (date: Date | string) => {
    try {
        const dateStr = formatManilaDate(date);

        // Direct bookings reads are owner/admin-only under RLS (20261101); this RPC returns every
        // blocking slot for the grid while masking other players' identities. Expired holds are excluded.
        const { data, error } = await supabase.rpc("get_public_slot_availability", {
            p_booking_date: dateStr,
        });

        if (error) throw error;

        return { data: (data || []) as BookingSlot[], error: null };
    } catch (error) {
        console.error("Failed to fetch bookings for date:", error);
        return { data: [], error };
    }
};
