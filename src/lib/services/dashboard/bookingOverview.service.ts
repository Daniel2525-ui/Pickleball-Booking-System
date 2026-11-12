import { supabase } from "@/lib/supabase";
import { DayData } from "./dashboardTypes";
import { formatManilaDate } from "@/lib/utils/bookingTime";

export const fetchBookingOverview = async () => {
    try {
        const todayStr = formatManilaDate(new Date());

        const todayManila = new Date(`${todayStr}T12:00:00+08:00`);
        const currentDay = todayManila.getDay();

        const distanceToMonday = currentDay === 0 ? -6 : 1 - currentDay;

        const monday = new Date(todayManila);
        monday.setDate(todayManila.getDate() + distanceToMonday);

        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);

        const mondayStr = formatManilaDate(monday);
        const sundayStr = formatManilaDate(sunday);

        const { data: bookings, error } = await supabase
            .from("bookings")
            .select("business_date")
            .gte("business_date", mondayStr)
            .lte("business_date", sundayStr)
            .in("status", ["confirmed", "completed", "checked_in", "in_progress", "no_show"])
            .or("open_play_session_id.is.null,open_play_spots.not.is.null");

        if (error) throw error;

        const weekData: DayData[] = [
            { day: "Monday", shortDay: "Mon", bookings: 0 },
            { day: "Tuesday", shortDay: "Tue", bookings: 0 },
            { day: "Wednesday", shortDay: "Wed", bookings: 0 },
            { day: "Thursday", shortDay: "Thu", bookings: 0 },
            { day: "Friday", shortDay: "Fri", bookings: 0 },
            { day: "Saturday", shortDay: "Sat", bookings: 0 },
            { day: "Sunday", shortDay: "Sun", bookings: 0 },
        ];

        (bookings || []).forEach((booking: { business_date: string }) => {
            if (!booking.business_date)
                return;

            const dayName = new Intl.DateTimeFormat("en-US", {
                weekday: "long",
                timeZone: "Asia/Manila",
            }).format(new Date(`${booking.business_date}T12:00:00+08:00`));

            const targetDay = weekData.find((d) => d.day === dayName);
            if (targetDay) {
                targetDay.bookings += 1;
            }
        });

        return { data: weekData, error: null }

    } catch (error) {
        console.error("Failed to fetch booking overview data", error)
        return {
            data: null,
            error
        }
    }
}