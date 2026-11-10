import { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getServiceClient } from "@/lib/supabase/service";
import { reconcileCheckoutSession } from "@/lib/services/payments/reconcileCheckoutSession";
import { sendBookingEmails } from "@/lib/services/bookings/bookingEmails";
import { xenditAsStripeSession } from "@/lib/xendit";

const sameToken = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function POST(req: NextRequest) {
    const expected = process.env.XENDIT_WEBHOOK_TOKEN;
    if (!expected) return Response.json({ error: "Configuration error" }, { status: 500 });
    if (!sameToken(req.headers.get("x-callback-token") ?? "", expected)) {
        return Response.json({ error: "Invalid callback token" }, { status: 401 });
    }

    const event = await req.json().catch(() => null);
    const prId = event?.data?.payment_request_id;
    if (event?.data?.status !== "SUCCEEDED" || typeof prId !== "string") return Response.json({ received: true });

    const supabase = getServiceClient();
    if (!supabase) return Response.json({ error: "Missing service role key" }, { status: 500 });

    // The webhook body is only a hint: the paid state and payment ids come from Xendit's own record
    const session = await xenditAsStripeSession(prId);
    if (session.payment_status !== "paid") return Response.json({ received: true });

    const outcome = await reconcileCheckoutSession(session, supabase);
    if (outcome.error) {
        console.error("Xendit reconciliation failed:", outcome.error);
        return Response.json({ error: outcome.error }, { status: 500 });
    }
    if (outcome.confirmed.length > 0) await sendBookingEmails(supabase);
    return Response.json({ received: true });
}
