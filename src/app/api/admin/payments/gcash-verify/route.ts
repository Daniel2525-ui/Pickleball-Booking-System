import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
    try {
        const { supabase, denied } = await requireAdmin();
        if (denied) return denied;

        const body = await request.json().catch(() => null);
        const basketId = typeof body?.basketId === "string" ? body.basketId.trim() : "";
        const action = body?.action;
        if (!basketId || (action !== "approve" && action !== "reject")) {
            return NextResponse.json({ error: "basketId and an action ('approve' or 'reject') are required." }, { status: 400 });
        }

        const { error } = await supabase.rpc(action === "approve" ? "approve_gcash_basket" : "reject_gcash_basket", {
            p_basket_id: basketId,
        });

        if (error) {
            console.error("GCash verification RPC error:", error);
            if (error.message?.includes("FORBIDDEN")) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
            if (error.message?.includes("UNAUTHORIZED")) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
            if (error.message?.includes("NOT_FOUND")) {
                return NextResponse.json({ error: "No submitted GCash payment found. It may already be handled; refresh." }, { status: 404 });
            }
            return NextResponse.json({ error: "Verification failed." }, { status: 500 });
        }

        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error("GCash verification error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
