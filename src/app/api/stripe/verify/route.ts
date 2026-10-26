import { NextRequest } from "next/server";
import { stripe } from "@/lib/stripe";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { processStripePaymentReconciliation } from "@/lib/services/payments/processStripePaymentReconciliation";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;

export async function POST(req: NextRequest) {
    try {
        // 1. Authenticate caller using session client
        const authClient = await createServerClient();
        const { data: { user } } = await authClient.auth.getUser();

        if (!user) {
            return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const { sessionId } = body;

        if (!sessionId || typeof sessionId !== "string") {
            return Response.json({ error: "Missing or invalid session ID" }, { status: 400 });
        }

        // 2. Retrieve session from Stripe
        const session = await stripe.checkout.sessions.retrieve(sessionId);

        if (!session) {
            return Response.json({ error: "Session not found" }, { status: 404 });
        }

        const bookingId = session.metadata?.booking_id;
        const paymentId = session.metadata?.payment_id;

        if (!bookingId || !paymentId) {
            return Response.json({ error: "Missing metadata" }, { status: 400 });
        }

        // 3. Verify user ownership of the booking
        const { data: booking, error: bookingErr } = await authClient
            .from("bookings")
            .select("id, user_id, status")
            .eq("id", bookingId)
            .single();

        if (bookingErr || !booking) {
            return Response.json({ error: "Booking not found" }, { status: 404 });
        }

        // Check if user owns booking or has admin role
        if (booking.user_id !== user.id) {
            const { data: profile } = await authClient
                .from("profiles")
                .select("role")
                .eq("id", user.id)
                .maybeSingle();

            if (profile?.role !== "admin") {
                return Response.json({ error: "Forbidden: You do not own this booking" }, { status: 403 });
            }
        }

        // 4. Validate payment status in Stripe
        if (session.payment_status !== "paid" && session.status !== "complete") {
            return Response.json(
                {
                    success: false,
                    status: session.payment_status,
                    error: "Payment was not completed. Your reservation hold has not been confirmed.",
                },
                { status: 400 }
            );
        }

        const amount = (session.amount_total || 0) / 100;
        const currency = (session.currency || "php").toLowerCase();
        const paymentIntent = typeof session.payment_intent === "string"
            ? session.payment_intent
            : session.payment_intent?.id || "";

        if (!paymentIntent) {
            return Response.json({ error: "Missing payment_intent in Stripe session" }, { status: 400 });
        }

        // 5. Reconcile transactionally using privileged service-role client
        const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!serviceRoleKey || serviceRoleKey.trim() === "") {
            console.error("Payment verification configuration error: SUPABASE_SERVICE_ROLE_KEY is required for reconciliation");
            return Response.json(
                { error: "Server configuration error: payment reconciliation service key missing" },
                { status: 500 }
            );
        }

        const supabaseAdmin = createAdminClient(supabaseUrl, serviceRoleKey);

        const outcome = await processStripePaymentReconciliation({
            bookingId,
            paymentId,
            amount,
            currency,
            stripeSessionId: session.id,
            stripePaymentIntent: paymentIntent,
            supabase: supabaseAdmin,
        });

        if (!outcome.success) {
            return Response.json(
                { error: outcome.error || "Payment reconciliation failed" },
                { status: 500 }
            );
        }

        if (outcome.action === "REFUND_SCHEDULED") {
            return Response.json({
                success: false,
                conflict: true,
                error: "This slot is no longer available. A full refund has been initiated.",
            });
        }

        return Response.json({ success: true, status: session.payment_status });
    } catch (err: unknown) {
        console.error("Verification error:", err);
        return Response.json({ error: (err as Error).message || "Verification failed" }, { status: 500 });
    }
}
