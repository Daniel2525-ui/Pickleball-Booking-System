import type { SupabaseClient } from "@supabase/supabase-js";
import { NO_SHOW_GRACE_MINUTES } from "@/lib/services/bookings/adminStatusRules";

export interface BookingPolicy {
    noShowGraceMinutes: number;
}

export const DEFAULT_POLICY: BookingPolicy = { noShowGraceMinutes: NO_SHOW_GRACE_MINUTES };

/** The venue's booking rules from Settings (public read); today's defaults if they can't be read. */
export const fetchBookingPolicy = async (client: SupabaseClient): Promise<BookingPolicy> => {
    const { data, error } = await client.from("booking_settings").select("no_show_grace_minutes").maybeSingle();
    if (error || !data) {
        if (error) console.error("Failed to load booking rules, using defaults:", error);
        return DEFAULT_POLICY;
    }
    return { noShowGraceMinutes: data.no_show_grace_minutes };
};
