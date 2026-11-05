import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/supabase/server";
import { validatePricingInput } from "@/lib/services/pricing/validatePricingInput";

/** Saves the base rate, booking length limits and peak windows (replaces all windows). Admin only. */
export async function POST(request: NextRequest) {
    try {
        const { supabase, denied } = await requireOwner();
        if (denied) return denied;

        const parsed = validatePricingInput(await request.json().catch(() => null));
        if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

        const { base_hourly_rate, min_hours, max_hours, peak_rates } = parsed.value;
        const { data, error } = await supabase.rpc("save_pricing_settings", {
            p_base_hourly_rate: base_hourly_rate,
            p_min_hours: min_hours,
            p_max_hours: max_hours,
            p_peak_rates: peak_rates,
        });

        if (error) {
            console.error("Failed to save pricing:", error);
            return NextResponse.json({ error: "Could not save pricing. Please check the values and try again." }, { status: 500 });
        }
        // Landing ("From ₱X/hr") and terms show the rates; refresh them on their next visit
        revalidatePath("/");
        revalidatePath("/terms");
        return NextResponse.json({ data });
    } catch (error) {
        console.error("Pricing route error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
