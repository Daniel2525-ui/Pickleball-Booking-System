import { supabase } from "@/lib/supabase";
import { fetchBusinessToday } from "@/lib/services/settings/bookingPolicy";
import { fetchSpotRows } from "@/lib/services/openPlay/openPlayData.service";
import { tallySpots } from "@/lib/services/openPlay/openPlayTypes";

export const todaysSchedule = async () => {
    try {
        // The business day: after midnight, last night's late bookings are still "today"
        const today = await fetchBusinessToday(supabase);
        const { data, error } = await supabase
            .from("bookings")
            .select(`
                id,
                basket_id,
                booking_date,
                start_time,
                end_time,
                status,
                court_id,
                open_play_session_id,
                open_play_spots,
                customer_name,
                courts (
                    name
                ),
                profiles:user_id (
                    full_name
                ),
                customers (
                    full_name
                ),
                open_play_sessions (
                    capacity
                )
            `)
            .eq("business_date", today)
            // Spot rows have no court; the block rows are what show a court busy with open play
            .not("court_id", "is", null)
            .in("status", ["confirmed", "checked_in", "in_progress", "completed", "no_show"])
            .order("booking_date", { ascending: true })
            .order("start_time", { ascending: true });

        if (error) throw error;

        // Open play court blocks show how full their session is
        const sessionIds = [...new Set((data ?? []).flatMap((b) => (b.open_play_session_id ? [b.open_play_session_id] : [])))];
        const spots = await fetchSpotRows(sessionIds);
        if (spots.error) console.error("Failed to count open play spots:", spots.error);
        const { booked } = tallySpots(spots.data);
        return (data ?? []).map((b) => ({ ...b, spots_booked: b.open_play_session_id ? booked.get(b.open_play_session_id) ?? 0 : null }));
    } catch (error) {
        console.error(error);
        throw error;
    }
};
