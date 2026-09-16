import { supabase } from "@/lib/supabase";
import { Court } from "./courtsTypes";

export const fetchCourtsData = async () => {
    try {
        const { data, error } = await supabase
            .from("courts")
            .select("id, name, status")
            .order("name", { ascending: true })

        if (error) throw error;
        return { data: (data || []) as Court[], error: null };
    } catch (error) {
        console.error("Failed to fetch courts", error)
        return { data: [], error }
    }
}