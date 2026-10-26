import { supabase } from "@/lib/supabase";
import { fetchCourtsData } from "../courts/courtsData.service";

const ACTIVE_STATUSES = ["confirmed", "completed", "checked_in", "in_progress"];

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
    const now = new Date();
    const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(now);

    const todayNoon = new Date(`${todayStr}T12:00:00+08:00`);
    const yesterdayDate = new Date(todayNoon);
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterdayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(yesterdayDate);

    const nextWeekDate = new Date(todayNoon);
    nextWeekDate.setDate(nextWeekDate.getDate() + 7);
    const endDateStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(nextWeekDate);

    const [bookingsRes, courtStats] = await Promise.all([
        supabase
            .from("bookings")
            .select("booking_date, total_amount")
            .gte("booking_date", yesterdayStr)
            .lte("booking_date", endDateStr)
            .in("status", ACTIVE_STATUSES),
        availableCourts(),
    ]);

    if (bookingsRes.error) throw bookingsRes.error;

    const bookings = bookingsRes.data || [];

    let todayBookingsCount = 0;
    let yesterdayBookingsCount = 0;
    let upcomingBookingsCount = 0;
    let revToday = 0;
    let revYesterday = 0;

    for (const b of bookings) {
        const amt = Number(b.total_amount) || 0;
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

/* Individual helpers preserved for backwards compatibility */
export const bookingsToday = async () => (await fetchDashboardCardStats()).todayBookingsCount;
export const bookingsYesterday = async () => (await fetchDashboardCardStats()).yesterdayBookingsCount;
export const upcomingBookings = async () => (await fetchDashboardCardStats()).upcomingBookingsCount;
export const revenueToday = async () => (await fetchDashboardCardStats()).revToday;
export const revenueYesterday = async () => (await fetchDashboardCardStats()).revYesterday;
