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
        
        // Find if any court is currently occupied
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, "0");
        const day = String(now.getDate()).padStart(2, "0");
        const currentDate = `${year}-${month}-${day}`;
        
        const hours = String(now.getHours()).padStart(2, "0");
        const minutes = String(now.getMinutes()).padStart(2, "0");
        const currentTime = `${hours}:${minutes}:00`;
        
        const { data: activeBookings, error: bookingsError } = await supabase
            .from("bookings")
            .select("court_id")
            .eq("booking_date", currentDate)
            .eq("status", "confirmed")
            .lte("start_time", currentTime)
            .gt("end_time", currentTime);

        if (bookingsError) throw bookingsError;

        const occupiedCourtIds = new Set(activeBookings?.map(b => b.court_id) || []);

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