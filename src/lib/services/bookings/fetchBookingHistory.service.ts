import { supabase } from "@/lib/supabase";
import { BookingEvent } from "./bookingHistory";

/** A booking's history, oldest first (staff only, by RLS). */
export const fetchBookingHistory = async (bookingId: string) => {
    const { data, error } = await supabase
        .from("booking_events")
        .select("id, action, detail, actor_id, created_at, profiles(full_name)")
        .eq("booking_id", bookingId)
        .order("created_at")
        .order("id");
    if (error) console.error("Failed to load booking history:", error);
    return { data: (data ?? []) as unknown as BookingEvent[], error };
};
