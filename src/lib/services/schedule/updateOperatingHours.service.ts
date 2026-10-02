import { supabase } from "@/lib/supabase";
import { OperatingHour } from "@/components/admin/schedules/types";

export const updateOperatingHours = async (hours: OperatingHour[]) => {
    try {
        // Insert or update rows based on the unique day_of_week constraint
        const payload = hours.map((hour) => ({
            day_of_week: hour.day,
            is_open: hour.isOpen,
            open_time: hour.isOpen && hour.openTime ? hour.openTime : null,
            close_time: hour.isOpen && hour.closeTime ? hour.closeTime : null,
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
