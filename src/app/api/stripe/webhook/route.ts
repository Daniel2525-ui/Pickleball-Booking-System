import { NextRequest } from "next/server";
import { stripe } from "@/lib/stripe";
import { getServiceClient } from "@/lib/supabase/service";
import Stripe from "stripe";
import { expireCheckoutSession, hasMetadata, reconcileCheckoutSession } from "@/lib/services/payments/reconcileCheckoutSession";

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

                if (!hasMetadata(session.metadata ?? {})) {
                    console.error("Missing metadata in session:", session.id);
                    break;
                }

                if (!session.payment_intent) {
                    console.error("Missing payment_intent in session:", session.id);
                    break;
                }

                const supabase = getServiceClient();
                if (!supabase) {
                    console.error("Webhook configuration error: SUPABASE_SERVICE_ROLE_KEY is required for payment reconciliation");
                    return Response.json({ error: "Server configuration error: missing service role key" }, { status: 500 });
                }

                const outcome = await reconcileCheckoutSession(session, supabase);

                if (outcome.error) {
                    console.error("Webhook payment reconciliation failed:", outcome.error);
                    return Response.json({ error: outcome.error }, { status: 500 });
                }

                console.log(`Reconciled checkout session ${session.id}: confirmed=${outcome.confirmed.length} refunded=${outcome.refunded.length}`);
                break;
            }

            case "checkout.session.async_payment_failed": {
                const session = event.data.object as Stripe.Checkout.Session;
                console.warn(`Checkout session ${session.id} async payment failed.`);
                break;
            }

            case "checkout.session.expired": {
                const session = event.data.object as Stripe.Checkout.Session;

                if (hasMetadata(session.metadata ?? {})) {
                    const supabase = getServiceClient();
                    if (!supabase) {
                        console.error("Webhook configuration error: SUPABASE_SERVICE_ROLE_KEY is required for expired booking cleanup");
                        return Response.json({ error: "Server configuration error: missing service role key" }, { status: 500 });
                    }

                    await expireCheckoutSession(session, supabase);
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
