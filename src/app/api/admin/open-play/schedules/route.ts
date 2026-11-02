import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
    try {
        const { supabase, denied } = await requireAdmin();
        if (denied) return denied;

        const b = await request.json().catch(() => null);
        const { data: id, error } = await supabase.rpc("save_open_play_schedule", {
            p_id: b?.id ?? null,
            p_day_of_week: b?.day_of_week,
            p_start_time: b?.start_time,
            p_end_time: b?.end_time,
            p_court_ids: b?.court_ids,
            p_capacity: b?.capacity,
            p_price_per_spot: b?.price_per_spot,
        });
        if (error) {
            console.error("save_open_play_schedule failed:", error);
            return NextResponse.json({ error: error.message || "Could not save the schedule." }, { status: 400 });
        }

        // Fill the calendar now rather than waiting for the cron
        const { data: generated, error: genError } = await supabase.rpc("generate_open_play_sessions");
        if (genError) console.error("generate_open_play_sessions failed:", genError);
        return NextResponse.json({ id, generated: generated ?? null });
    } catch (error) {
        console.error("Open play schedule error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

export async function PATCH(request: NextRequest) {
    try {
        const { supabase, denied } = await requireAdmin();
        if (denied) return denied;

        const b = await request.json().catch(() => null);
        if (typeof b?.id !== "string" || typeof b?.active !== "boolean") {
            return NextResponse.json({ error: "id and active are required." }, { status: 400 });
        }
        const { error } = await supabase.rpc("set_open_play_schedule_active", { p_id: b.id, p_active: b.active });
        if (error) {
            console.error("set_open_play_schedule_active failed:", error);
            return NextResponse.json({ error: error.message || "Could not update the schedule." }, { status: 400 });
        }
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Open play schedule error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
