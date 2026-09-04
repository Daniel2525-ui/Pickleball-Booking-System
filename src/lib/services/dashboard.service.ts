import { supabase } from "@/lib/supabase"

/* Today's Bookings */

export const bookingsToday = async () => {
    const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Manila",
    }).format(new Date())

    try {
        const { count, error } = await supabase
            .from("bookings")
            .select("*", { count: "exact", head: true })
            .eq("booking_date", today)
            .neq("status", "cancelled")

        if (error) throw error;
        return count ?? 0
    } catch (error) {
        console.error(error)
        throw error;
    }

}

/* Insert another queries/logic here */