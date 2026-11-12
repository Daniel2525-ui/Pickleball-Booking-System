import { supabase } from "@/lib/supabase";
import { shiftDate } from "@/lib/utils/bookingTime";
import { fetchBusinessToday } from "@/lib/services/settings/bookingPolicy";
import { fetchCourtsData } from "../courts/courtsData.service";
import { fetchSpotRows } from "../openPlay/openPlayData.service";
import { tallySpots } from "../openPlay/openPlayTypes";
import { LiveCourtTile, LiveSlot, liveCourtTile } from "./liveCourts";

/** Every court's live tile: who is on it now, how long they have, whether they paid, and who is next. */
export const fetchLiveCourts = async (now: Date = new Date()): Promise<{ data: LiveCourtTile[] | null; error: Error | null }> => {
    try {
        // The business day: after midnight, last night's late bookings are still "today"
        const today = await fetchBusinessToday(supabase);
        const [{ data: slots, error: slotsError }, { data: sessions, error: sessionsError }] = await Promise.all([
            supabase
                .from("bookings")
                .select("id, court_id, booking_date, start_time, end_time, status, hold_expires_at, total_amount, open_play_session_id, customer_name, profiles(full_name), customers(full_name), payments(status, amount, payment_method)")
                .eq("business_date", today)
                .not("court_id", "is", null)
                // Pending included: liveCourtTile keeps those whose hold hasn't run out
                .in("status", ["pending", "confirmed", "checked_in", "in_progress"]),
            supabase.from("open_play_sessions").select("id, capacity").in("session_date", [today, shiftDate(today, 1)]).neq("status", "cancelled"),
        ]);
        if (slotsError) throw slotsError;
        if (sessionsError) throw sessionsError;

        // Today's bookings are already loaded, so the courts query needn't fetch them again
        const { data: courts, error: courtsError } = await fetchCourtsData((slots ?? []) as unknown as LiveSlot[]);
        if (courtsError || !courts) throw courtsError || new Error("Failed to fetch courts");

        const { data: spotRows, error: spotsError } = await fetchSpotRows((sessions ?? []).map((s) => s.id));
        if (spotsError) throw spotsError;
        const { booked } = tallySpots(spotRows, now);
        const spots = Object.fromEntries((sessions ?? []).map((s) => [s.id, { booked: booked.get(s.id) ?? 0, capacity: s.capacity }]));

        return { data: courts.map((c) => liveCourtTile(c, (slots ?? []) as unknown as LiveSlot[], now, spots)), error: null };
    } catch (error) {
        console.error("Failed to fetch live courts", error);
        return { data: null, error: error as Error };
    }
};
