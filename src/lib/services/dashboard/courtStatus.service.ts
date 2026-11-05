import { supabase } from "@/lib/supabase";
import { formatManilaDate } from "@/lib/utils/bookingTime";
import { fetchCourtsData } from "../courts/courtsData.service";
import { fetchSpotRows } from "../openPlay/openPlayData.service";
import { tallySpots } from "../openPlay/openPlayTypes";
import { LiveCourtTile, LiveSlot, liveCourtTile } from "./liveCourts";

/** Every court's live tile: who is on it now, how long they have, whether they paid, and who is next. */
export const fetchLiveCourts = async (now: Date = new Date()): Promise<{ data: LiveCourtTile[] | null; error: Error | null }> => {
    try {
        const today = formatManilaDate(now);
        const [{ data: courts, error: courtsError }, { data: slots, error: slotsError }, { data: sessions, error: sessionsError }] = await Promise.all([
            fetchCourtsData(),
            supabase
                .from("bookings")
                .select("id, court_id, booking_date, start_time, end_time, status, total_amount, open_play_session_id, customer_name, profiles(full_name), customers(full_name), payments(status, amount, payment_method)")
                .eq("booking_date", today)
                .not("court_id", "is", null)
                .in("status", ["confirmed", "checked_in", "in_progress"]),
            supabase.from("open_play_sessions").select("id, capacity").eq("session_date", today).neq("status", "cancelled"),
        ]);
        if (courtsError || !courts) throw courtsError || new Error("Failed to fetch courts");
        if (slotsError) throw slotsError;
        if (sessionsError) throw sessionsError;

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
