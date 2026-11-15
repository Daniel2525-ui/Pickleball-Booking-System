import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/server";
import { sessionErrorResponse } from "@/lib/services/openPlay/openPlayTypes";
import { checkCounterQr } from "@/lib/xendit";

export async function POST(request: NextRequest) {
    try {
        const { supabase, denied } = await requireAdmin();
        if (denied) return denied;

        const b = await request.json().catch(() => null);
        const reference = typeof b?.payment_reference === "string" ? b.payment_reference.trim() : null;
        // A QR Ph walk-up must be a front-desk code Xendit reports paid for spots × the session's price
        if (b?.payment_method === "gcash") {
            if (!reference) return NextResponse.json({ error: "The QR Ph payment reference is required." }, { status: 400 });
            const { data: session, error: sessionError } = await supabase
                .from("open_play_sessions").select("price_per_spot").eq("id", b?.sessionId).maybeSingle();
            if (sessionError || !session) return NextResponse.json({ error: "Session not found." }, { status: 404 });
            try {
                const problem = await checkCounterQr(supabase, reference, Number(b?.spots) * Number(session.price_per_spot));
                if (problem) return NextResponse.json({ error: problem }, { status: 409 });
            } catch (qrError) {
                console.error("Open play walk-up: failed to check the QR Ph payment:", qrError);
                return NextResponse.json({ error: "Could not confirm the QR Ph payment with Xendit. Please try again." }, { status: 502 });
            }
        }
        const { data, error } = await supabase.rpc("add_open_play_walkup", {
            p_session_id: b?.sessionId,
            p_customer_id: b?.customerId,
            p_customer_name: b?.customerName,
            p_spots: b?.spots,
            p_payment_method: b?.payment_method,
            p_payment_reference: reference,
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
