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
            .in("status", ["confirmed", "completed", "ongoing"]);

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
            .in("status", ["confirmed", "completed", "ongoing"]);

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
            .in("status", ["confirmed", "completed", "ongoing"]);

        if (error) throw error;

        return count ?? 0;
    } catch (error) {
        console.error(error);
        throw error;
    }
};

export const revenueToday = async () => {
    const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Manila",
    }).format(new Date());

    try {
        const { data, error } = await supabase
            .from("bookings")
            .select("total_amount")
            .eq("booking_date", today)
            .in("status", ["confirmed", "completed", "ongoing"]);

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
            .in("status", ["confirmed", "completed", "ongoing"]);

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
    const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Manila",
    }).format(new Date());

    const now = new Date().toLocaleTimeString("en-GB", {
        timeZone: "Asia/Manila",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });

    try {
        const { data: courts, error: courtsError } = await supabase
            .from("courts")
            .select("id");

        if (courtsError) throw courtsError;

        const { data: bookings, error: bookingsError } = await supabase
            .from("bookings")
            .select("court_id, start_time, end_time")
            .eq("booking_date", today)
            .in("status", ["confirmed", "completed", "ongoing"])
            .lte("start_time", now)
            .gt("end_time", now);

        if (bookingsError) throw bookingsError;

        const occupiedCourts = new Set(
            bookings.map((booking) => booking.court_id)
        );

        const totalCourts = courts.length;
        const occupied = occupiedCourts.size;
        const available = totalCourts - occupied;

        return {
            total: totalCourts,
            occupied,
            available,
        };
    } catch (error) {
        console.error(error);
        throw error;
    }
};

