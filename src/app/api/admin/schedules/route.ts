import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

        const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
        if (profile?.role !== "admin") return NextResponse.json({ error: "Admin access required." }, { status: 403 });

        const body = await request.json().catch(() => null);
        const hours = Array.isArray(body?.hours) ? body.hours : null;

        if (!hours || hours.length === 0) {
            return NextResponse.json({ error: "Operating hours data is required." }, { status: 400 });
        }

        const payload = hours.map((hour: { day_of_week: string; is_open: boolean; open_time?: string | null; close_time?: string | null }) => ({
            day_of_week: hour.day_of_week,
            is_open: Boolean(hour.is_open),
            open_time: hour.is_open && hour.open_time ? hour.open_time : null,
            close_time: hour.is_open && hour.close_time ? hour.close_time : null,
        }));

        const { data, error } = await supabase
            .from("operating_hours")
            .upsert(payload, { onConflict: "day_of_week" })
            .select();

        if (error) {
            console.error("Failed to update operating hours:", error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ data });
    } catch (error) {
        console.error("Schedules update route error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
