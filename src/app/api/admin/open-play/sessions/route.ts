import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/server";

/** Adds a one-time open play session on a specific date; create_open_play_session validates everything. */
export async function POST(request: NextRequest) {
    try {
        const { supabase, denied } = await requireAdmin();
        if (denied) return denied;

        const b = await request.json().catch(() => null);
        const { data: id, error } = await supabase.rpc("create_open_play_session", {
            p_date: b?.session_date,
            p_start_time: b?.start_time,
            p_end_time: b?.end_time,
            p_court_ids: b?.court_ids,
            p_capacity: b?.capacity,
            p_price_per_spot: b?.price_per_spot,
        });
        if (error) {
            console.error("create_open_play_session failed:", error);
            // The SQL messages are written for staff after their code ("COURT_BOOKED: Court 1 is already booked ...")
            const message = (error.message || "").replace(/^[A-Z_]+:\s*/, "");
            return NextResponse.json({ error: message || "Could not add the session." }, { status: 400 });
        }
        return NextResponse.json({ id });
    } catch (error) {
        console.error("Open play session error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
