import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPaymentRequest, xendit } from "@/lib/xendit";

// GET: the QR page polls the status. POST: test-mode only "customer paid" button for the demo.
async function load(req: NextRequest) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
    const pr = req.nextUrl.searchParams.get("pr") ?? "";
    if (!pr.startsWith("pr-")) return { error: Response.json({ error: "Invalid payment" }, { status: 400 }) };
    return { pr: await getPaymentRequest(pr) };
}

export async function GET(req: NextRequest) {
    try {
        const { pr, error } = await load(req);
        return error ?? Response.json({ status: pr.status });
    } catch (err) {
        console.error("Xendit status error:", err);
        return Response.json({ error: "Could not reach Xendit" }, { status: 502 });
    }
}

export async function POST(req: NextRequest) {
    if (!process.env.XENDIT_SECRET_KEY?.startsWith("xnd_development_")) {
        return Response.json({ error: "Simulation is only available in test mode" }, { status: 403 });
    }
    try {
        const { pr, error } = await load(req);
        if (error) return error;
        await xendit(`/v3/payment_requests/${pr.payment_request_id}/simulate`, { amount: pr.request_amount });
        return Response.json({ ok: true });
    } catch (err) {
        console.error("Xendit simulate error:", err);
        return Response.json({ error: "Simulation failed" }, { status: 502 });
    }
}
