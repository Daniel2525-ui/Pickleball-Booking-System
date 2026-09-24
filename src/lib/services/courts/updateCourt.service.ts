import { supabase } from "@/lib/supabase";

export const updateCourt = async (id: string, name: string, status: string) => {
    try {
        const { data, error } = await supabase
            .from("courts")
            .update({ name, status })
            .eq("id", id)
            .select()
            .single();

        if (error) throw error;
        return { data, error: null };
    } catch (error) {
        console.error("Failed to update court", error);
        return { data: null, error: error as Error };
    }
};
