import { supabase } from "@/lib/supabase";
import { CourtOption } from "./bookingsTypes";

export const fetchCourts = async () => {
    try {
        const { data, error } = await supabase
            .from("courts")
            .select("id, name")
            .order("name", {
                ascending: true
            })

        if (error) throw error;
        return { data: (data || []) as CourtOption[], error: null }
    } catch (error) {
        console.error("Failed to fetch courts", error);
        return { data: [], error }
    }
}