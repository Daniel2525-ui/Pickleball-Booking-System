import { NextRequest } from "next/server";
import { stripe } from "@/lib/stripe";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

// Webhooks don't have cookies, so we need a service role client or regular client
// Since we are updating records, we need a server context.
// NextJS Route Handlers can use the regular Supabase JS client with service role key if needed.
// Or we can just rely on the existing one if RLS allows it. Let's use service role if available,
// else regular env vars.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceRole);

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

export async function POST(req: NextRequest) {
    if (!webhookSecret) {
        console.error("Missing STRIPE_WEBHOOK_SECRET");
        return Response.json({ error: "Configuration error" }, { status: 500 });
    }

    try {
        const body = await req.text();
        const signature = req.headers.get("stripe-signature");

        if (!signature) {
            return Response.json({ error: "Missing stripe-signature header" }, { status: 400 });
        }

        let event: Stripe.Event;

        try {
            event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
        } catch (err: any) {
            console.error(`Webhook signature verification failed. ${err.message}`);
            return Response.json({ error: err.message }, { status: 400 });
        }

        // Handle the event
        switch (event.type) {
            case "checkout.session.completed": {
                const session = event.data.object as Stripe.Checkout.Session;

                const bookingId = session.metadata?.booking_id;
                const paymentId = session.metadata?.payment_id;

                if (!bookingId || !paymentId) {
                    console.error("Missing metadata in session:", session.id);
                    break;
                }

                // Fetch the pending booking details
                const { data: booking } = await supabase
                    .from("bookings")
                    .select("*")
                    .eq("id", bookingId)
                    .single();

                if (!booking) {
                    console.error("Booking not found:", bookingId);
                    break;
                }

                // Check for double booking
                const { data: conflicts } = await supabase
                    .from("bookings")
                    .select("id")
                    .eq("court_id", booking.court_id)
                    .eq("booking_date", booking.booking_date)
                    .eq("status", "confirmed")
                    .lt("start_time", booking.end_time)
                    .gt("end_time", booking.start_time);

                if (conflicts && conflicts.length > 0) {
                    console.log(`Double booking detected for ${bookingId}. Refunding payment_intent: ${session.payment_intent}`);

                    if (session.payment_intent) {
                        try {
                            await stripe.refunds.create({
                                payment_intent: session.payment_intent as string,
                            });
                        } catch (refundError) {
                            console.error("Refund failed:", refundError);
                        }
                    }

                    // Update payment to refunded
                    await supabase
                        .from("payments")
                        .update({
                            status: "refunded",
                            stripe_payment_id: session.payment_intent as string || null,
                        })
                        .eq("id", paymentId);

                    // Update booking to cancelled
                    await supabase
                        .from("bookings")
                        .update({ status: "cancelled" })
                        .eq("id", bookingId);

                    break;
                }

                // If no conflicts, proceed with confirming the payment and booking
                // Update payment to succeeded
                await supabase
                    .from("payments")
                    .update({
                        status: "succeeded",
                        stripe_payment_id: session.payment_intent as string || null,
                        paid_at: new Date().toISOString()
                    })
                    .eq("id", paymentId);

                // Update booking to confirmed
                await supabase
                    .from("bookings")
                    .update({ status: "confirmed" })
                    .eq("id", bookingId);

                break;
            }
            case "checkout.session.expired": {
                const session = event.data.object as Stripe.Checkout.Session;

                const bookingId = session.metadata?.booking_id;
                const paymentId = session.metadata?.payment_id;

                if (!bookingId || !paymentId) break;

                // Update payment to failed
                await supabase
                    .from("payments")
                    .update({ status: "failed" })
                    .eq("id", paymentId);

                // Update booking to cancelled/failed
                await supabase
                    .from("bookings")
                    .update({ status: "cancelled" })
                    .eq("id", bookingId);

                break;
            }
            default:
                console.log(`Unhandled event type ${event.type}`);
        }

        return Response.json({ received: true });
    } catch (err) {
        console.error("Webhook error:", err);
        return Response.json({ error: "Webhook handler failed" }, { status: 500 });
    }
}
