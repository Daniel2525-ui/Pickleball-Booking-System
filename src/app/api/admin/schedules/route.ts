import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/supabase/server";
import { checkWeeklyHours } from "@/lib/services/schedule/hoursRules";

export async function POST(request: NextRequest) {
    try {
        const { supabase, denied } = await requireAdmin();
        if (denied) return denied;

        const body = await request.json().catch(() => null);
        const { data: settings, error: settingsError } = await supabase.from("booking_settings").select("day_ends_at").maybeSingle();
        if (settingsError || !settings) {
            console.error("Failed to read day_ends_at:", settingsError);
            return NextResponse.json({ error: "Could not check the hours. Try again." }, { status: 500 });
        }
        // The day cutoff may change in the same save; the hours are then checked against the new one
        const dayEndsAt: string = body?.day_ends_at ?? settings.day_ends_at;
        if (typeof dayEndsAt !== "string" || !/^(0\d|1[0-2]):00(:00)?$/.test(dayEndsAt) || dayEndsAt.slice(0, 5) > "12:00") {
            return NextResponse.json({ error: "The day can end on any whole hour from 12:00 AM to 12:00 PM." }, { status: 400 });
        }
        // Same checks as the page: every day once, whole hours, closing after opening or after midnight up to the day's end
        const checked = checkWeeklyHours(body?.hours, dayEndsAt);
        if ("error" in checked) {
            return NextResponse.json({ error: checked.error }, { status: 400 });
        }
        const payload = checked.rows;

        if (dayEndsAt.slice(0, 5) !== settings.day_ends_at.slice(0, 5)) {
            // Settings are the owner's (row-level security): for anyone else the update changes no row
            const { data: changed, error: cutoffError } = await supabase.from("booking_settings").update({ day_ends_at: dayEndsAt }).eq("id", true).select("id");
            if (cutoffError) {
                console.error("Failed to update day_ends_at:", cutoffError);
                return NextResponse.json({ error: "Could not save when the day ends. Try again." }, { status: 500 });
            }
            if (!changed?.length) {
                return NextResponse.json({ error: "Only the owner can change when the day ends." }, { status: 403 });
            }
        }

        const { data, error } = await supabase
            .from("operating_hours")
            .upsert(payload, { onConflict: "day_of_week" })
            .select();

        if (error) {
            console.error("Failed to update operating hours:", error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        revalidatePath("/"); // landing page shows the opening hours
        return NextResponse.json({ data });
    } catch (error) {
        console.error("Schedules update route error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
