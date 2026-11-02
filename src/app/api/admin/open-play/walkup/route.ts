import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/server";
import { sessionErrorResponse } from "@/lib/services/openPlay/openPlayTypes";

export async function POST(request: NextRequest) {
    try {
        const { supabase, denied } = await requireAdmin();
        if (denied) return denied;

        const b = await request.json().catch(() => null);
        const { data, error } = await supabase.rpc("add_open_play_walkup", {
            p_session_id: b?.sessionId,
            p_customer_id: b?.customerId,
            p_customer_name: b?.customerName,
            p_spots: b?.spots,
            p_payment_method: b?.payment_method,
            p_payment_reference: typeof b?.payment_reference === "string" ? b.payment_reference.trim() : null,
        });
        if (error) {
            const mapped = sessionErrorResponse(error.message);
            if (mapped) return NextResponse.json(mapped, { status: 409 });
            if (error.message?.includes("INVALID_ARGUMENT")) {
                return NextResponse.json({ error: error.message.replace(/^.*INVALID_ARGUMENT:\s*/, "") }, { status: 400 });
            }
            console.error("add_open_play_walkup failed:", error);
            return NextResponse.json({ error: "Could not add the walk-up." }, { status: 500 });
        }
        return NextResponse.json({ success: true, data });
    } catch (error) {
        console.error("Open play walk-up error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
