import { supabase } from "@/lib/supabase";
import { fetchCourtsData } from "../courts/courtsData.service";

export const fetchCourtStatus = async () => {
    try {
        const { data: courts, error } = await fetchCourtsData();
        if (error || !courts) throw (error || new Error("Failed to fetch courts"));

        // Courts held by an open play session that is running right now (block rows: court set, no spots)
        const now = new Date();
        const { data: blocks, error: blockError } = await supabase
            .from("bookings")
            .select("court_id")
            .eq("booking_date", new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(now))
            .lte("start_time", now.toLocaleTimeString("en-GB", { timeZone: "Asia/Manila", hour12: false }))
            .gt("end_time", now.toLocaleTimeString("en-GB", { timeZone: "Asia/Manila", hour12: false }))
            .not("open_play_session_id", "is", null)
            .is("open_play_spots", null)
            .neq("status", "cancelled");
        if (blockError) throw blockError;
        const openPlayCourts = new Set((blocks ?? []).map((b) => b.court_id));

        const courtsWithStatus = courts.map((court) => {
            const normalizedStatus = (court.status || "").toLowerCase();
            if (normalizedStatus === "maintenance") {
                return { name: court.name, status: "Maintenance" as const };
            }
            if (normalizedStatus === "closed") {
                return { name: court.name, status: "Closed" as const };
            }
            if (openPlayCourts.has(court.id)) {
                return { name: court.name, status: "Open play" as const };
            }
            if (normalizedStatus === "occupied") {
                return { name: court.name, status: "In Use" as const };
            }
            return {
                name: court.name,
                status: "Available" as const,
            };
        });

        return {
            data: { courts: courtsWithStatus },
            error: null,
        };
    } catch (error) {
        console.error("Failed to fetch court status", error);
        return {
            data: null,
            error: error as Error,
        };
    }
};
