import { NextRequest } from "next/server";
import { stripe } from "@/lib/stripe";
import { createClient } from "@supabase/supabase-js";

// We need a service role client to update the records, just like the webhook.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceRole);

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { sessionId } = body;

        if (!sessionId) {
            return Response.json({ error: "Missing session ID" }, { status: 400 });
        }

        const session = await stripe.checkout.sessions.retrieve(sessionId);

        if (!session) {
            return Response.json({ error: "Session not found" }, { status: 404 });
        }

        const bookingId = session.metadata?.booking_id;
        const paymentId = session.metadata?.payment_id;

        if (!bookingId || !paymentId) {
            return Response.json({ error: "Missing metadata" }, { status: 400 });
        }

        if (session.payment_status === "paid" || session.status === "complete") {
            // Check if booking is already confirmed (maybe webhook beat us to it)
            const { data: booking } = await supabase
                .from("bookings")
                .select("status")
                .eq("id", bookingId)
                .single();

            if (booking && booking.status !== "confirmed") {
                // Confirm the payment
                await supabase
                    .from("payments")
                    .update({
                        status: "paid",
                        stripe_payment_id: session.payment_intent as string || null,
                        paid_at: new Date().toISOString()
                    })
                    .eq("id", paymentId);

                // Confirm the booking
                await supabase
                    .from("bookings")
                    .update({ status: "confirmed" })
                    .eq("id", bookingId);
            }
        }

        return Response.json({ success: true, status: session.payment_status });
    } catch (err: any) {
        console.error("Verification error:", err);
        return Response.json({ error: "Verification failed" }, { status: 500 });
    }
}
