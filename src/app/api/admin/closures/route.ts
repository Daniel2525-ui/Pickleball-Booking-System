import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/server";

const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

/** Closes the venue for one whole day (customers can no longer book it; staff still can). */
export async function POST(request: NextRequest) {
    try {
        const { supabase, denied } = await requireAdmin();
        if (denied) return denied;

        const body = await request.json().catch(() => null);
        const date = typeof body?.date === "string" ? body.date.trim() : "";
        const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
        if (!isDate(date)) return NextResponse.json({ error: "Choose a valid date." }, { status: 400 });
        if (reason.length > 120) return NextResponse.json({ error: "Keep the reason under 120 characters." }, { status: 400 });

        const { data, error } = await supabase
            .from("venue_closures")
            .upsert({ closed_on: date, reason: reason || null }, { onConflict: "closed_on" })
            .select()
            .single();
        if (error) {
            console.error("Failed to add venue closure:", error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }
        return NextResponse.json({ data });
    } catch (error) {
        console.error("Closures POST route error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

/** Reopens a closed date. */
export async function DELETE(request: NextRequest) {
    try {
        const { supabase, denied } = await requireAdmin();
        if (denied) return denied;

        const body = await request.json().catch(() => null);
        const date = typeof body?.date === "string" ? body.date.trim() : "";
        if (!isDate(date)) return NextResponse.json({ error: "Choose a valid date." }, { status: 400 });

        const { error } = await supabase.from("venue_closures").delete().eq("closed_on", date);
        if (error) {
            console.error("Failed to remove venue closure:", error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }
        return NextResponse.json({ data: { closed_on: date } });
    } catch (error) {
        console.error("Closures DELETE route error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
