import { supabase } from "@/lib/supabase";

export const deleteCourt = async (id: string) => {
    try {
        const { error } = await supabase
            .from("courts")
            .delete()
            .eq("id", id);

        if (error) throw error;
        return { error: null };
    } catch (error) {
        console.error("Failed to delete court", error);
        return { error: error as Error };
    }
};
