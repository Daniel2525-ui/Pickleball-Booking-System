import { NextRequest } from "next/server";
import { stripe } from "@/lib/stripe";
import { getServiceClient } from "@/lib/supabase/service";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { reconcileCheckoutSession } from "@/lib/services/payments/reconcileCheckoutSession";

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
        const bookingId = session.metadata?.booking_id;
        const paymentId = session.metadata?.payment_id;

        if (!basketId && (!bookingId || !paymentId)) {
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
                .select("id, user_id, status, courts(name)")
                .eq(basketId ? "basket_id" : "id", basketId ?? bookingId);
            return error ? null : (data as unknown as { id: string; user_id: string; status: string; courts: { name: string } | null }[]);
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
        const finalBookings = (await loadBookings()) ?? bookings;
        const lostCourts = finalBookings
            .filter((b) => b.status === "cancelled")
            .map((b) => b.courts?.name ?? "Court");

        if (lostCourts.length === finalBookings.length) {
            return Response.json({
                success: false,
                conflict: true,
                lostCourts,
                error: "This slot is no longer available. A full refund has been initiated.",
            });
        }

        return Response.json({ success: true, status: session.payment_status, lostCourts });
    } catch (err: unknown) {
        console.error("Verification error:", err);
        return Response.json({ error: "Verification failed" }, { status: 500 });
    }
}
