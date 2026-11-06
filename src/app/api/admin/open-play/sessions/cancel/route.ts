import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/supabase/service";
import { closeSiblingSessions } from "@/lib/services/bookings/cancelPendingBasket";

export async function POST(request: NextRequest) {
    try {
        const { supabase, denied } = await requireAdmin();
        if (denied) return denied;

        const body = await request.json().catch(() => null);
        const sessionId = typeof body?.sessionId === "string" ? body.sessionId.trim() : "";
        if (!sessionId) return NextResponse.json({ error: "sessionId is required." }, { status: 400 });

        const { data, error } = await supabase.rpc("cancel_open_play_session", { p_session_id: sessionId });
        if (error) {
            if (error.message?.includes("GCASH_PENDING_VERIFICATION")) {
                return NextResponse.json(
                    { error: "Approve or reject the GCash payments waiting for verification first." },
                    { status: 409 }
                );
            }
            if (error.message?.includes("NOT_FOUND")) {
                return NextResponse.json({ error: "Session not found." }, { status: 404 });
            }
            console.error("cancel_open_play_session failed:", error);
            return NextResponse.json({ error: "Could not cancel the session." }, { status: 500 });
        }

        // The session is already cancelled. Payments are non-refundable by default: players who ask are refunded by staff
        const admin = getServiceClient();
        if (admin) {
            const ids = (data?.booking_ids ?? []) as string[];
            // Expire open Checkouts of the cancelled holds so nobody pays for a cancelled session (late payments still auto-refund)
            const { data: pays, error: payErr } = await admin.from("payments").select("stripe_session_id").in("booking_id", ids).not("stripe_session_id", "is", null);
            if (payErr) console.error("Open play cancel: could not load Stripe sessions:", payErr);
            // One call per session: a paid one ("paid") must not stop the others from being expired
            for (const stripe_session_id of new Set((pays ?? []).map((p) => p.stripe_session_id))) {
                try {
                    await closeSiblingSessions([{ payments: [{ stripe_session_id }] } as never]);
                } catch (stripeError) {
                    console.error("Open play cancel: failed to expire Stripe session:", stripeError);
                }
            }
        } else {
            console.error("Open play cancel: SUPABASE_SERVICE_ROLE_KEY missing; open checkouts not expired");
        }
        return NextResponse.json({ cancelled: data?.cancelled ?? 0 });
    } catch (error) {
        console.error("Open play cancel error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
