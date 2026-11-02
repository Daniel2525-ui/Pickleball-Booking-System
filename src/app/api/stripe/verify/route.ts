import { NextRequest } from "next/server";
import { stripe } from "@/lib/stripe";
import { getServiceClient } from "@/lib/supabase/service";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { reconcileCheckoutSession } from "@/lib/services/payments/reconcileCheckoutSession";
import { bookingTitle } from "@/lib/services/openPlay/bookingTitle";

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

        const basketId = session.metadata?.basket_id;

        if (!basketId) {
            return Response.json({ error: "Missing metadata" }, { status: 400 });
        }

        // Rows are loaded with the service role so no court of a basket is hidden from the ownership check
        const supabaseAdmin = getServiceClient();
        if (!supabaseAdmin) {
            console.error("Payment verification configuration error: SUPABASE_SERVICE_ROLE_KEY is required for reconciliation");
            return Response.json(
                { error: "Server configuration error: payment reconciliation service key missing" },
                { status: 500 }
            );
        }

        const loadBookings = async () => {
            const { data, error } = await supabaseAdmin
                .from("bookings")
                .select("id, user_id, status, open_play_spots, courts(name), payments(stripe_session_id)")
                .eq("basket_id", basketId);
            return error ? null : (data as unknown as { id: string; user_id: string; status: string; open_play_spots: number | null; courts: { name: string } | null; payments: { stripe_session_id: string | null }[] }[]);
        };

        // 3. Verify user ownership of every booking in the checkout
        const bookings = await loadBookings();

        if (!bookings || bookings.length === 0) {
            return Response.json({ error: "Booking not found" }, { status: 404 });
        }

        // Check if user owns all bookings or has admin role
        if (bookings.some((b) => b.user_id !== user.id)) {
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
        // A "complete" session can still be unpaid (async methods); only a paid session confirms a booking
        if (session.payment_status !== "paid") {
            return Response.json(
                {
                    success: false,
                    status: session.payment_status,
                    error: "Payment was not completed. Your reservation hold has not been confirmed.",
                },
                { status: 400 }
            );
        }

        if (!session.payment_intent) {
            return Response.json({ error: "Missing payment_intent in Stripe session" }, { status: 400 });
        }

        // 5. Reconcile each court transactionally using privileged service-role client
        const outcome = await reconcileCheckoutSession(session, supabaseAdmin);

        if (outcome.error) {
            console.error("Payment verification reconciliation failed:", outcome.error);
            return Response.json(
                { error: "Payment reconciliation failed. Your payment is safe; please check 'My Bookings' shortly." },
                { status: 500 }
            );
        }

        // Read lost courts from the final rows: the webhook may have refunded them first (this call is then a NO_OP)
        const finalBookings = await loadBookings();
        if (!finalBookings) {
            console.error(`Payment verification: re-reading bookings after reconciling ${session.id} failed`);
            return Response.json(
                { error: "Payment reconciliation failed. Your payment is safe; please check 'My Bookings' shortly." },
                { status: 500 }
            );
        }
        // Only cancelled rows this session charged: a court released before the customer resumed payment
        // is still in the basket, but was never paid for, so nothing was refunded for it
        const lostCourts = finalBookings
            .filter((b) => b.status === "cancelled" && (b.payments ?? []).some((p) => p.stripe_session_id === session.id))
            .map(bookingTitle);

        const openPlay = finalBookings.some((b) => b.open_play_spots);
        // Nothing left active (e.g. staff cancelled the session mid-checkout): the payment is refunded
        if (finalBookings.every((b) => b.status === "cancelled")) {
            return Response.json({
                success: false,
                conflict: true,
                lostCourts,
                openPlay,
                error: openPlay ? "This session is no longer available. A full refund has been initiated." : "This slot is no longer available. A full refund has been initiated.",
            });
        }

        return Response.json({ success: true, status: session.payment_status, lostCourts, openPlay });
    } catch (err: unknown) {
        console.error("Verification error:", err);
        return Response.json({ error: "Verification failed" }, { status: 500 });
    }
}
