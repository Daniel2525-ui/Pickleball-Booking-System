import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/supabase/server";
import { checkWeeklyHours } from "@/lib/services/schedule/hoursRules";

export async function POST(request: NextRequest) {
    try {
        const { supabase, denied } = await requireAdmin();
        if (denied) return denied;

        const body = await request.json().catch(() => null);
        // Same checks as the page: every day once, whole hours, closing after opening
        const checked = checkWeeklyHours(body?.hours);
        if ("error" in checked) {
            return NextResponse.json({ error: checked.error }, { status: 400 });
        }
        const payload = checked.rows;

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
