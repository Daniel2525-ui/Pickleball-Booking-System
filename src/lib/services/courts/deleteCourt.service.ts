import { supabase } from "@/lib/supabase";

export const deleteCourt = async (id: string) => {
    try {
        // Prevent deleting a court that has associated reservations
        const { data: existingBookings, error: checkError } = await supabase
            .from("bookings")
            .select("id")
            .eq("court_id", id)
            .limit(1);

        if (checkError) throw checkError;

        if (existingBookings && existingBookings.length > 0) {
            return {
                error: new Error(
                    "This court cannot be deleted because it has associated booking records. Please set its status to 'Maintenance' or 'Closed' instead."
                ),
            };
        }

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
