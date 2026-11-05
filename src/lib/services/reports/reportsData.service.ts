import { supabase } from "@/lib/supabase";
import type { VenueReport } from "./reports";

/** The whole report for a period (from = null for all time). Admins only; anyone else gets the error text. */
export async function fetchVenueReport(from: string | null, to: string): Promise<{ data: VenueReport | null; error: string | null }> {
    const { data, error } = await supabase.rpc("get_venue_report", { p_from: from, p_to: to });
    if (error) {
        console.error("Failed to load the report:", error);
        return { data: null, error: "Could not load the report. Please try again." };
    }
    return { data: data as VenueReport, error: null };
}
