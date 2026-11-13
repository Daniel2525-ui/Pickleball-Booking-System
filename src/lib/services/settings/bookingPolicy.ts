import type { SupabaseClient } from "@supabase/supabase-js";
import { NO_SHOW_GRACE_MINUTES } from "@/lib/services/bookings/adminStatusRules";
import { businessToday } from "@/lib/utils/bookingTime";

export interface BookingPolicy {
    noShowGraceMinutes: number;
    /** Business-day cutoff "HH:MM:SS": hours before it belong to the previous day */
    dayEndsAt: string;
    /** Most players one court takes; a checkout allows this times its courts */
    maxPlayersPerCourt: number;
    /** Most open play spots one player may book in a session */
    maxOpenPlaySpots: number;
}

export const DEFAULT_POLICY: BookingPolicy = { noShowGraceMinutes: NO_SHOW_GRACE_MINUTES, dayEndsAt: "00:00:00", maxPlayersPerCourt: 8, maxOpenPlaySpots: 4 };

/** The venue's booking rules from Settings (public read); today's defaults if they can't be read. */
export const fetchBookingPolicy = async (client: SupabaseClient): Promise<BookingPolicy> => {
    const { data, error } = await client.from("booking_settings").select("no_show_grace_minutes, day_ends_at, max_players_per_court, max_open_play_spots_per_player").maybeSingle();
    if (error || !data) {
        if (error) console.error("Failed to load booking rules, using defaults:", error);
        return DEFAULT_POLICY;
    }
    return { noShowGraceMinutes: data.no_show_grace_minutes, dayEndsAt: data.day_ends_at, maxPlayersPerCourt: data.max_players_per_court, maxOpenPlaySpots: data.max_open_play_spots_per_player };
};

/** Today's business day for this venue (at 1 AM it is still yesterday); bookings.business_date is compared with it. */
export const fetchBusinessToday = async (client: SupabaseClient): Promise<string> =>
    businessToday((await fetchBookingPolicy(client)).dayEndsAt);
