import { supabase } from "@/lib/supabase";
import { Court } from "./courtsTypes";
import { calculateCourtPrice } from "./calculateCourtPrice.service";

export const fetchCourtsData = async () => {
    try {
        const { data: courts, error: courtsError } = await supabase
            .from("courts")
            .select("id, name, status")
            .order("name", { ascending: true });

        if (courtsError) throw courtsError;

        // Find if any court is currently occupied (in Asia/Manila timezone)
        const currentDate = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Manila",
        }).format(new Date());

        const currentTime = new Date().toLocaleTimeString("en-GB", {
            timeZone: "Asia/Manila",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
        });

        const { data: activeBookings, error: bookingsError } = await supabase
            .from("bookings")
            .select("court_id")
            .eq("booking_date", currentDate)
            .in("status", ["confirmed", "ongoing"])
            .lte("start_time", currentTime)
            .gt("end_time", currentTime);

        if (bookingsError) throw bookingsError;

        const occupiedCourtIds = new Set(activeBookings?.map(booking => booking.court_id) || []);

        const updatedCourts = (courts || []).map(court => {
            let finalStatus = court.status;
            if ((court.status === "active" || court.status === "available") && occupiedCourtIds.has(court.id)) {
                finalStatus = "occupied";
            }
            return {
                ...court,
                status: finalStatus,
                price: calculateCourtPrice()
            };
        });

        return { data: updatedCourts as Court[], error: null };
    } catch (error) {
        console.error("Failed to fetch courts", error);
        return { data: [], error };
    }
}