import { supabase } from "@/lib/supabase";
import { SpotRow } from "./openPlayTypes";

/** Spot rows that can hold a place in these sessions: confirmed-type rows and pending holds (tallySpots drops expired ones). */
export const fetchSpotRows = async (sessionIds: string[]) => {
    if (!sessionIds.length) return { data: [] as SpotRow[], error: null };
    const { data, error } = await supabase
        .from("bookings")
        .select("open_play_session_id, open_play_spots, status, hold_expires_at")
        .in("open_play_session_id", sessionIds)
        .is("court_id", null)
        .in("status", ["confirmed", "checked_in", "in_progress", "completed", "pending"]);
    return { data: (data ?? []) as SpotRow[], error };
};

export interface OpenPlaySession {
    id: string;
    session_date: string;
    start_time: string;
    end_time: string;
    court_names: string[];
    capacity: number;
    spots_left: number;
    price_per_spot: number;
    my_spots: number;
}

export const fetchOpenPlaySessions = async (from: string, to: string) => {
    const { data, error } = await supabase.rpc("get_open_play_sessions", { p_from: from, p_to: to });
    if (error) console.error("Failed to fetch open play sessions:", error);
    return { data: (data ?? []) as OpenPlaySession[], error };
};

export const bookOpenPlay = async (sessionId: string, spots: number, method: "stripe" | "gcash"): Promise<{ url?: string; error?: string }> => {
    try {
        const res = await fetch("/api/open-play/book", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId, spots, payment_method: method }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.url) return { error: body.error ?? "Could not book your spots. Please try again." };
        return { url: body.url };
    } catch {
        return { error: "Could not reach the server. Check your connection and try again." };
    }
};
