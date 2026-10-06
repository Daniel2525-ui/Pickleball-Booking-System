import { supabase } from "@/lib/supabase";
import { OperatingHour } from "@/components/admin/schedules/types";

export const updateOperatingHours = async (hours: OperatingHour[]) => {
    try {
        // Insert or update rows based on the unique day_of_week constraint
        const payload = hours.map((hour) => ({
            day_of_week: hour.day_of_week,
            is_open: hour.is_open,
            open_time: hour.is_open && hour.open_time ? hour.open_time : null,
            close_time: hour.is_open && hour.close_time ? hour.close_time : null,
        }));

        const { data, error } = await supabase
            .from("operating_hours")
            .upsert(payload, { onConflict: 'day_of_week' })
            .select();

        if (error) {
            console.error("Upsert failed:", error.message);
            return { data: null, error };
        }

        return { data, error: null };
    } catch (error) {
        console.error("Failed to update operating hours:", error);
        return { data: null, error };
    }
};
