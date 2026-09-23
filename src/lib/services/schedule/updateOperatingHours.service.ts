import { supabase } from "@/lib/supabase";
import { OperatingHour } from "@/components/admin/schedules/types";

export const updateOperatingHours = async (hours: OperatingHour[]) => {
    try {
        // Delete all existing rows
        await supabase.from("operating_hours").delete().neq("id", 0);

        // Insert fresh rows
        const payload = hours.map((hour) => ({
            day_of_week: hour.day,
            is_open: hour.isOpen,
            open_time: hour.isOpen && hour.openTime ? hour.openTime : null,
            close_time: hour.isOpen && hour.closeTime ? hour.closeTime : null,
        }));

        const { data, error } = await supabase
            .from("operating_hours")
            .insert(payload)
            .select();

        if (error) {
            console.error("Insert failed:", error.message);
            return { data: null, error };
        }

        return { data, error: null };
    } catch (error) {
        console.error("Failed to update operating hours:", error);
        return { data: null, error };
    }
};
