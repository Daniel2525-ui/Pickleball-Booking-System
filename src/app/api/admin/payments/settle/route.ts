import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient();

        // 1. Authenticate caller
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
        }

        // 2. Validate request payload
        const body = await request.json().catch(() => null);
        const paymentId = typeof body?.paymentId === "string" ? body.paymentId.trim() : "";
        const bookingId = typeof body?.bookingId === "string" ? body.bookingId.trim() : "";
        const paymentMethod = typeof body?.paymentMethod === "string" ? body.paymentMethod.trim().toLowerCase() : "";
        const paymentReference = typeof body?.paymentReference === "string" ? body.paymentReference.trim() : null;

        if (!paymentId || !bookingId || (paymentMethod !== "cash" && paymentMethod !== "gcash")) {
            return NextResponse.json(
                { error: "paymentId, bookingId, and a valid paymentMethod ('cash' or 'gcash') are required." },
                { status: 400 }
            );
        }

        if (paymentMethod === "gcash" && !paymentReference) {
            return NextResponse.json(
                { error: "paymentReference is required for GCash payments." },
                { status: 400 }
            );
        }

        // 3. Execute atomic counter settlement via database RPC
        const { data: settleRes, error: settleErr } = await supabase.rpc("settle_counter_payment", {
            p_booking_id: bookingId,
            p_payment_id: paymentId,
            p_payment_method: paymentMethod,
            p_payment_reference: paymentReference,
        });

        if (settleErr) {
            console.error("Counter settlement RPC error:", settleErr);
            if (settleErr.message?.includes("FORBIDDEN")) {
                return NextResponse.json({ error: "Admin access required." }, { status: 403 });
            }
            if (
                settleErr.message?.includes("INVALID_STATUS") ||
                settleErr.message?.includes("SLOT_UNAVAILABLE") ||
                settleErr.message?.includes("MATCH_START_PASSED")
            ) {
                return NextResponse.json({ error: settleErr.message }, { status: 409 });
            }
            return NextResponse.json({ error: settleErr.message || "Settlement failed." }, { status: 500 });
        }

        return NextResponse.json({ success: true, data: settleRes });
    } catch (error) {
        console.error("Counter settlement error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
