import { supabase } from "@/lib/supabase";

export const addCourt = async (name: string, status: string) => {
    try {
        const { data, error } = await supabase
            .from("courts")
            .insert([{ name, status }])
            .select()
            .single();

        if (error) throw error;
        return { data, error: null };
    } catch (error) {
        console.error("Failed to add court", error);
        return { data: null, error };
    }
};
