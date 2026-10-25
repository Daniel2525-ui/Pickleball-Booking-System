import { supabase } from "@/lib/supabase"
import { fetchCourtsData } from "../courts/courtsData.service"

const ACTIVE_STATUSES = ["confirmed", "completed", "checked_in", "in_progress"];
const OCCUPYING_STATUSES = ["confirmed", "checked_in", "in_progress"];

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
            .in("status", ACTIVE_STATUSES);

        if (error) throw error;
        return count ?? 0
    } catch (error) {
        console.error(error)
        throw error;
    }
}

export const bookingsYesterday = async () => {
    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterday = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Manila",
    }).format(yesterdayDate);

    try {
        const { count, error } = await supabase
            .from("bookings")
            .select("*", { count: "exact", head: true })
            .eq("booking_date", yesterday)
            .in("status", ACTIVE_STATUSES);

        if (error) throw error;
        return count ?? 0;
    } catch (error) {
        console.error(error);
        throw error;
    }
};

/* Upcoming Bookings */
export const upcomingBookings = async () => {
    const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Manila",
    }).format(new Date());

    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);

    const endDate = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Manila",
    }).format(nextWeek);

    try {
        const { count, error } = await supabase
            .from("bookings")
            .select("*", { count: "exact", head: true })
            .gte("booking_date", today)
            .lte("booking_date", endDate)
            .in("status", ACTIVE_STATUSES);

        if (error) throw error;

        return count ?? 0;
    } catch (error) {
        console.error(error);
        throw error;
    }
};


/* Today's Revenue */
export const revenueToday = async () => {
    const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Manila",
    }).format(new Date());

    try {
        const { data, error } = await supabase
            .from("bookings")
            .select("total_amount")
            .eq("booking_date", today)
            .in("status", ACTIVE_STATUSES);

        if (error) throw error;

        const revenue = data.reduce(
            (total, booking) => total + booking.total_amount, 0
        )

        return revenue;
    } catch (error) {
        console.error(error)
        throw error
    }
}

export const revenueYesterday = async () => {
    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterday = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Manila",
    }).format(yesterdayDate);

    try {
        const { data, error } = await supabase
            .from("bookings")
            .select("total_amount")
            .eq("booking_date", yesterday)
            .in("status", ACTIVE_STATUSES);

        if (error) throw error;

        const revenue = data.reduce(
            (total, booking) => total + booking.total_amount, 0
        );

        return revenue;
    } catch (error) {
        console.error(error);
        throw error;
    }
};

/* Available Courts */
export const availableCourts = async () => {
    try {
        const { data: courts, error } = await fetchCourtsData();
        if (error || !courts) throw (error || new Error("Failed to load court status"));

        const occupied = courts.filter((c) => c.status === "occupied").length;
        const playableCourts = courts.filter((court) => {
            const status = (court.status || "").toLowerCase();
            return status === "active" || status === "available" || status === "occupied";
        });

        const totalPlayable = playableCourts.length;
        const available = Math.max(0, totalPlayable - occupied);

        return {
            total: courts.length,
            occupied,
            available,
        };
    } catch (error) {
        console.error("availableCourts error:", error);
        throw error;
    }
};

