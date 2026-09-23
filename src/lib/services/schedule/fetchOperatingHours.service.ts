import { supabase } from "@/lib/supabase";
import { OperatingHour } from "@/components/admin/schedules/types";

export const fetchOperatingHours = async () => {
    try {
        const { data, error } = await supabase
            .from("operating_hours")
            .select("*");

        if (error) throw error;

        const formattedHours: OperatingHour[] = (data || []).map((item) => ({
            id: item.id,
            day: item.day_of_week,
            isOpen: item.is_open,
            openTime: item.open_time ? item.open_time.slice(0, 5) : "",
            closeTime: item.close_time ? item.close_time.slice(0, 5) : "",
        }));

        return { data: formattedHours, error: null };
    } catch (error) {
        console.error("Failed to fetch operating hours:", error);
        return { data: [], error };
    }
};
