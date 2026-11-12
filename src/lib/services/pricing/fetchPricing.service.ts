import type { SupabaseClient } from "@supabase/supabase-js";
import type { Pricing } from "./quoteCourtPrice";

/** Loads the admin-configured pricing (public read) with the caller's client (browser or server). */
export const fetchPricing = async (client: SupabaseClient): Promise<{ data: Pricing | null; error: unknown }> => {
    const [settingsRes, peaksRes] = await Promise.all([
        client.from("booking_settings").select("base_hourly_rate, min_hours, max_hours, day_ends_at").maybeSingle(),
        client.from("peak_rates").select("id, label, days, start_time, end_time, hourly_rate").order("start_time"),
    ]);
    const error = settingsRes.error || peaksRes.error || (!settingsRes.data ? new Error("Pricing is not configured") : null);
    if (error) {
        console.error("Failed to load pricing:", error);
        return { data: null, error };
    }
    return {
        data: {
            settings: {
                base_hourly_rate: Number(settingsRes.data!.base_hourly_rate),
                min_hours: settingsRes.data!.min_hours,
                max_hours: settingsRes.data!.max_hours,
                day_ends_at: settingsRes.data!.day_ends_at,
            },
            peakRates: (peaksRes.data ?? []).map((p) => ({ ...p, hourly_rate: Number(p.hourly_rate) })),
        },
        error: null,
    };
};
