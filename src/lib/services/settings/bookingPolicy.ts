import type { SupabaseClient } from "@supabase/supabase-js";
import { CANCELLATION_CUTOFF_HOURS } from "@/lib/services/bookings/cancelBooking.service";
import { NO_SHOW_GRACE_MINUTES } from "@/lib/services/bookings/adminStatusRules";

export interface BookingPolicy {
    cancelCutoffHours: number;
    noShowGraceMinutes: number;
}

export const DEFAULT_POLICY: BookingPolicy = { cancelCutoffHours: CANCELLATION_CUTOFF_HOURS, noShowGraceMinutes: NO_SHOW_GRACE_MINUTES };

/** The venue's booking rules from Settings (public read); today's defaults if they can't be read. */
export const fetchBookingPolicy = async (client: SupabaseClient): Promise<BookingPolicy> => {
    const { data, error } = await client.from("booking_settings").select("cancel_cutoff_hours, no_show_grace_minutes").maybeSingle();
    if (error || !data) {
        if (error) console.error("Failed to load booking rules, using defaults:", error);
        return DEFAULT_POLICY;
    }
    return { cancelCutoffHours: data.cancel_cutoff_hours, noShowGraceMinutes: data.no_show_grace_minutes };
};
