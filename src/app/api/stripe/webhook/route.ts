import { NextRequest } from "next/server";
import { stripe } from "@/lib/stripe";
import { getServiceClient } from "@/lib/supabase/service";
import Stripe from "stripe";
import { processStripePaymentReconciliation } from "@/lib/services/payments/processStripePaymentReconciliation";

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
        } catch (err: unknown) {
            const message = (err as Error).message || "Verification failed";
            console.error(`Webhook signature verification failed. ${message}`);
            return Response.json({ error: message }, { status: 400 });
        }

        switch (event.type) {
            case "checkout.session.completed":
            case "checkout.session.async_payment_succeeded": {
                const session = event.data.object as Stripe.Checkout.Session;

                if (session.payment_status !== "paid") {
                    console.log(`Checkout session ${session.id} payment_status is '${session.payment_status}'. Awaiting payment settlement.`);
                    break;
                }

                const bookingId = session.metadata?.booking_id;
                const paymentId = session.metadata?.payment_id;

                if (!bookingId || !paymentId) {
                    console.error("Missing metadata in session:", session.id);
                    break;
                }

                const amount = (session.amount_total || 0) / 100;
                const currency = (session.currency || "php").toLowerCase();
                const paymentIntent = typeof session.payment_intent === "string"
                    ? session.payment_intent
                    : session.payment_intent?.id || "";

                if (!paymentIntent) {
                    console.error("Missing payment_intent in session:", session.id);
                    break;
                }

                const supabase = getServiceClient();
                if (!supabase) {
                    console.error("Webhook configuration error: SUPABASE_SERVICE_ROLE_KEY is required for payment reconciliation");
                    return Response.json({ error: "Server configuration error: missing service role key" }, { status: 500 });
                }

                const outcome = await processStripePaymentReconciliation({
                    bookingId,
                    paymentId,
                    amount,
                    currency,
                    stripeSessionId: session.id,
                    stripePaymentIntent: paymentIntent,
                    supabase,
                });

                if (!outcome.success) {
                    console.error("Webhook payment reconciliation failed:", outcome.error);
                    return Response.json({ error: outcome.error }, { status: 500 });
                }

                console.log(`Reconciled checkout session ${session.id}: action=${outcome.action}`);
                break;
            }

            case "checkout.session.async_payment_failed": {
                const session = event.data.object as Stripe.Checkout.Session;
                console.warn(`Checkout session ${session.id} async payment failed.`);
                break;
            }

            case "checkout.session.expired": {
                const session = event.data.object as Stripe.Checkout.Session;

                const bookingId = session.metadata?.booking_id;
                const paymentId = session.metadata?.payment_id;

                if (bookingId && paymentId) {
                    const supabase = getServiceClient();
                    if (!supabase) {
                        console.error("Webhook configuration error: SUPABASE_SERVICE_ROLE_KEY is required for expired booking cleanup");
                        return Response.json({ error: "Server configuration error: missing service role key" }, { status: 500 });
                    }

                    const cancelRes = await supabase.rpc("cancel_expired_booking", {
                        p_booking_id: bookingId,
                        p_payment_id: paymentId,
                    });
                    console.log(`Checkout session expired cleanup for booking ${bookingId}:`, cancelRes.data);
                }

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
