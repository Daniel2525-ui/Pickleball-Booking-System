import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/supabase/service";
import { refundPaidStripePayments } from "@/lib/services/payments/refundPaidStripePayments";

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

        // The session is already cancelled; refunds never throw and anything left is retried by cron / staff
        const admin = getServiceClient();
        if (admin) {
            for (const id of (data?.booking_ids ?? []) as string[]) {
                await refundPaidStripePayments(admin, id, { reason: "VENUE_CANCELLED_OPEN_PLAY", keyPrefix: "ref_open_play_cancel_" });
            }
        } else {
            console.error("Open play cancel: SUPABASE_SERVICE_ROLE_KEY missing; refunds left for staff");
        }
        return NextResponse.json({ cancelled: data?.cancelled ?? 0 });
    } catch (error) {
        console.error("Open play cancel error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
