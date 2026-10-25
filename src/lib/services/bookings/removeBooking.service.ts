import { supabase } from "@/lib/supabase";

export const removeBooking = async (id: string) => {
    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return { error: new Error("Unauthorized.") };

        const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
        if (profile?.role !== "admin") return { error: new Error("Admin privileges required.") };

        const { error } = await supabase
            .from("bookings")
            .delete()
            .eq("id", id);

        if (error) throw error;
        return { error: null };
    } catch (error) {
        console.error("Failed to remove booking:", error);
        return { error: error as Error };
    }
};