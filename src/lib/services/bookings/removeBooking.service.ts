import { supabase } from "@/lib/supabase";

export const removeBooking = async (id: string) => {
    try {
        const { error } = await supabase
            .from("bookings")
            .delete()
            .eq("id", id)

        if (error) throw error;
        return { error: null }
    } catch (error) {
        console.error("Failed to remove booking:", error)
        return { error }
    }
}