import { supabase } from "@/lib/supabase";
import { fetchCourtsData, ActiveBookingSnippet } from "../courts/courtsData.service";
import { formatManilaDate } from "@/lib/utils/bookingTime";

// no_show is a sold booking (prepaid money is kept), so it counts toward bookings and paid revenue
const ACTIVE_STATUSES = ["confirmed", "completed", "checked_in", "in_progress", "no_show"];

export interface DashboardCardStatsData {
    todayBookingsCount: number;
    yesterdayBookingsCount: number;
    upcomingBookingsCount: number;
    revToday: number;
    revYesterday: number;
    courtStats: {
        total: number;
        occupied: number;
        available: number;
    };
}

/**
 * Consolidates all dashboard KPI metrics into a single range query
 * plus parallel court availability fetch.
 */
export const fetchDashboardCardStats = async (): Promise<DashboardCardStatsData> => {
    const todayStr = formatManilaDate(new Date());

    const todayNoon = new Date(`${todayStr}T12:00:00+08:00`);
    const yesterdayDate = new Date(todayNoon);
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterdayStr = formatManilaDate(yesterdayDate);

    const nextWeekDate = new Date(todayNoon);
    nextWeekDate.setDate(nextWeekDate.getDate() + 7);
    const endDateStr = formatManilaDate(nextWeekDate);

    const { data: bookings, error } = await supabase
        .from("bookings")
        .select("court_id, open_play_session_id, open_play_spots, start_time, end_time, status, booking_date, total_amount, payments(status, amount)")
        .gte("booking_date", yesterdayStr)
        .lte("booking_date", endDateStr)
        .in("status", ACTIVE_STATUSES);

    if (error) throw error;

    const allBookings = bookings || [];
    const todayActive = allBookings
        // Spot rows have no court; the block rows already occupy the courts
        .filter((b) => b.court_id && b.booking_date === todayStr && (b.status === "confirmed" || b.status === "checked_in" || b.status === "in_progress"))
        .map((b) => ({
            court_id: b.court_id as string,
            booking_date: b.booking_date,
            status: b.status,
            start_time: b.start_time,
            end_time: b.end_time,
        }));

    const courtStats = await availableCourts(todayActive);

    let todayBookingsCount = 0;
    let yesterdayBookingsCount = 0;
    let upcomingBookingsCount = 0;
    let revToday = 0;
    let revYesterday = 0;

    for (const b of allBookings) {
        // Block rows reserve courts but are not bookings; spot rows count (their revenue is in total_amount)
        if (b.open_play_session_id && !b.open_play_spots) continue;
        const payments = Array.isArray(b.payments) ? b.payments : (b.payments ? [b.payments] : []);
        const isPaid = payments.some((p: { status?: string }) => p.status === "paid" || p.status === "succeeded");
        const amt = isPaid ? (Number(b.total_amount) || 0) : 0;

        if (b.booking_date === todayStr) {
            todayBookingsCount++;
            revToday += amt;
        }
        if (b.booking_date === yesterdayStr) {
            yesterdayBookingsCount++;
            revYesterday += amt;
        }
        if (b.booking_date >= todayStr && b.booking_date <= endDateStr) {
            upcomingBookingsCount++;
        }
    }

    return {
        todayBookingsCount,
        yesterdayBookingsCount,
        upcomingBookingsCount,
        revToday,
        revYesterday,
        courtStats,
    };
};

/* Available Courts */
export const availableCourts = async (activeBookingsOverride?: ActiveBookingSnippet[]) => {
    try {
        const { data: courts, error } = await fetchCourtsData(activeBookingsOverride);
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
