import { supabase } from "@/lib/supabase";

export const fetchCourtStatus = async () => {
    const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Manila"
    }).format(new Date());

    const now = new Date().toLocaleTimeString("en-CA",
        {
            timeZone: "Asia/Manila",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        }
    )

    try {
        const { data: courts, error } = await supabase
            .from("courts")
            .select(`
            id,
            name,
            status
            `)
            .order("name")

        if (error) throw error;


        const { data: bookings, error: bookingError } = await supabase
            .from("bookings")
            .select(`
                court_id,
                booking_date,
                start_time,
                end_time,
                status
                `)
            .eq("booking_date", today)
            .neq("status", "cancelled")

        if (bookingError) throw bookingError;

        const courtsWithStatus = courts.map((court) => {
            const isOccupied = bookings.some(
                (booking) =>
                    booking.court_id === court.id &&
                    booking.start_time <= now &&
                    booking.end_time > now
            );
            return {
                name: court.name,
                status: (isOccupied ? "In Use" : "Available") as "In Use" | "Available",
            };
        })

        return {
            data: { courts: courtsWithStatus },
            error: null
        }


    } catch (error) {
        console.error("Failed to fetch court status", error)
        return {
            data: null,
            error
        }
    }
}