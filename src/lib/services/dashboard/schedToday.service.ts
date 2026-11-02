import { supabase } from "@/lib/supabase";

export const todaysSchedule = async () => {
    const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Manila",
    }).format(new Date());

    try {
        const { data, error } = await supabase
            .from("bookings")
            .select(`
                id,
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
                )
            `)
            .eq("booking_date", today)
            // Spot rows have no court; the block rows are what show a court busy with open play
            .not("court_id", "is", null)
            .in("status", ["confirmed", "checked_in", "in_progress", "completed", "no_show"])
            .order("start_time", { ascending: true });

        if (error) throw error;

        return data ?? [];
    } catch (error) {
        console.error(error);
        throw error;
    }
};
