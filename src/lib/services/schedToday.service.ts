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
                courts (
                    name
                ),
                profiles:user_id (
                    full_name
                )
            `)
            .eq("booking_date", today)
            .order("start_time", { ascending: true });

        if (error) throw error;

        return data ?? [];
    } catch (error) {
        console.error(error);
        throw error;
    }
};
