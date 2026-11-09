import { supabase } from "@/lib/supabase";
import { formatManilaDate } from "@/lib/utils/bookingTime";

export interface CourtBlock {
    id: string;
    block_date: string;
    start_time: string;
    end_time: string;
    reason: string | null;
    courts: { name: string } | null;
}

/** Blocks from today on, soonest first (staff only under RLS). */
export const fetchUpcomingBlocks = async () => {
    const { data, error } = await supabase
        .from("court_blocks")
        .select("id, block_date, start_time, end_time, reason, courts(name)")
        .gte("block_date", formatManilaDate())
        .order("block_date")
        .order("start_time");
    if (error) console.error("Failed to load court blocks:", error);
    return { data: (data ?? []) as unknown as CourtBlock[], error };
};

/** Every court, for the block form. */
export const fetchCourtNames = async () => {
    const { data, error } = await supabase.from("courts").select("id, name").order("name");
    if (error) console.error("Failed to load courts:", error);
    return (data ?? []) as { id: string; name: string }[];
};

const send = async (method: "POST" | "DELETE", body: object) => {
    try {
        const res = await fetch("/api/admin/court-blocks", {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        const json = await res.json().catch(() => null);
        return res.ok ? { error: null } : { error: new Error(json?.error || "Could not update court blocks.") };
    } catch {
        return { error: new Error("Could not reach the server. Check your connection and try again.") };
    }
};

export const addBlock = (block: { courtId: string; date: string; start: string; end: string; reason: string }) => send("POST", block);
export const removeBlock = (id: string) => send("DELETE", { id });
