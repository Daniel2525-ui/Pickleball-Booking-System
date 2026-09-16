import { supabase } from "@/lib/supabase";
import { DayData } from "./dashboardTypes";

export const fetchBookingOverview = async () => {
    try {
        const now = new Date();
        const currentDay = now.getDay();

        const disanceToMonday = currentDay === 0 ? -6 : 1 - currentDay;

        const monday = new Date(now);

        monday.setDate(now.getDate() + disanceToMonday);

        const sunday = new Date(monday)

        sunday.setDate(monday.getDate() + 6)

        const formatToYMD = (date: Date) => new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Manila"
        }).format(date);

        const mondayStr = formatToYMD(monday);
        const sundayStr = formatToYMD(sunday);

        const { data: bookings, error } = await supabase
            .from("bookings")
            .select("booking_date")
            .gte("booking_date", mondayStr)
            .lte("booking_date", sundayStr)
            .neq("status", "cancelled")

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

        (bookings || []).forEach((b: { booking_date: string }) => {
            if (!b.booking_date)
                return;

            const dateObj = new Date(b.booking_date + "T00:00:00");
            const dayOfWeek = dateObj.getDay();

            const dayIndex = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

            if (weekData[dayIndex])

                weekData[dayIndex].bookings += 1;
        })

        return { data: weekData, error: null }

    } catch (error) {
        console.error("Failed to fetch booking overview data", error)
        return {
            data: null,
            error
        }
    }
}