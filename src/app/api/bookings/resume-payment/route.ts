import { NextRequest } from "next/server";
import { stripe } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import { getBookingStart } from "@/lib/utils/bookingTime.ts";
import { formatTime12h } from "@/lib/utils/formatTime";
import { getServiceClient } from "@/lib/supabase/service";
import { type BasketSibling, loadPendingSiblings } from "@/lib/services/bookings/basketSiblings";

const toDbTime = (t: string) => (t.length === 5 ? `${t}:00` : t);

/**
 * Customer-initiated payment resumption for an unfinished pending booking.
 *
 * Security:
 * - Authenticated session cookie is required.
 * - Ownership is verified on the server: booking.user_id === user.id.
 * - Enforces that booking status is strictly "pending".
 * - Validates that the scheduled match start time has not already passed.
 * - Checks for conflicting confirmed reservations.
 * - Reuses existing open Stripe Checkout session if still valid, or safely
 *   generates a fresh Checkout session for the existing booking.
 * - An unpaid basket resumes as one unit: every pending court of the user's basket, in one session.
 */
export async function POST(request: NextRequest) {
    try {
        // 1. Authenticate the user from session cookie
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
            return Response.json(
                { error: "You must be logged in to resume payment." },
                { status: 401 }
            );
        }

        // 2. Validate input
        const body = await request.json().catch(() => null);
        const bookingId = typeof body?.bookingId === "string" ? body.bookingId.trim() : "";

        if (!bookingId) {
            return Response.json({ error: "Missing booking ID." }, { status: 400 });
        }

        // 3. Load the booking scoped to current user
        const { data: booking, error: fetchError } = await supabase
            .from("bookings")
            .select("id, user_id, status, basket_id")
            .eq("id", bookingId)
            .eq("user_id", user.id)
            .maybeSingle();

        if (fetchError) {
            console.error("Resume payment: failed to load booking:", fetchError);
            return Response.json(
                { error: "Could not load the booking. Please try again." },
                { status: 500 }
            );
        }

        if (!booking) {
            return Response.json({ error: "Booking not found." }, { status: 404 });
        }

        // 4. Verify booking is in 'pending' status
        const currentStatus = (booking.status || "").toLowerCase();
        if (currentStatus !== "pending") {
            if (currentStatus === "confirmed" || currentStatus === "paid") {
                return Response.json(
                    { error: "This booking has already been confirmed and paid." },
                    { status: 400 }
                );
            }
            if (currentStatus === "cancelled") {
                return Response.json(
                    { error: "This booking was cancelled and can no longer be paid." },
                    { status: 400 }
                );
            }
            return Response.json(
                { error: `This booking cannot be resumed (status: ${booking.status}).` },
                { status: 400 }
            );
        }

        // Every pending court of the basket, derived from the loaded booking and scoped to this user
        const admin = getServiceClient();
        if (!admin) {
            console.error("Resume payment: SUPABASE_SERVICE_ROLE_KEY missing");
            return Response.json(
                { error: "Payment is temporarily unavailable. Please contact the venue." },
                { status: 500 }
            );
        }
        const { siblings, error: siblingsError } = await loadPendingSiblings(admin, booking, user.id);
        if (siblingsError) {
            console.error("Resume payment: failed to load basket:", siblingsError);
            return Response.json(
                { error: "Could not load the booking. Please try again." },
                { status: 500 }
            );
        }
        const clicked = siblings.find((s) => s.id === booking.id);
        if (!clicked) {
            return Response.json(
                { error: "This booking was just updated. Please refresh the page." },
                { status: 409 }
            );
        }

        for (const line of siblings) {
            // 5. Check if the scheduled match time has already passed
            if (getBookingStart(line) <= new Date()) {
                return Response.json(
                    { error: "The scheduled match time has already passed." },
                    { status: 409 }
                );
            }

            // 6. Check for double booking conflicts with confirmed bookings
            const { data: conflicts } = await supabase
                .from("bookings")
                .select("id")
                .eq("court_id", line.court_id)
                .eq("booking_date", line.booking_date)
                .neq("id", line.id)
                .in("status", ["confirmed", "completed", "checked_in", "in_progress"])
                .lt("start_time", toDbTime(line.end_time))
                .gt("end_time", toDbTime(line.start_time));

            if (conflicts && conflicts.length > 0) {
                return Response.json(
                    { error: "This time slot is no longer available. Please choose another slot." },
                    { status: 409 }
                );
            }
        }

        // 7. If the shared Stripe session is already open and valid, reuse it
        const sharedSessionId = clicked.payments[0]?.stripe_session_id;
        if (sharedSessionId) {
            try {
                const existingSession = await stripe.checkout.sessions.retrieve(sharedSessionId);

                if (existingSession.status === "open" && existingSession.url) {
                    return Response.json({ url: existingSession.url });
                }

                // Paid but not yet confirmed (late webhook): a new session would charge the customer twice
                if (existingSession.status === "complete") {
                    return Response.json(
                        { error: "Payment for this booking has already been received and is being processed. Please refresh the page in a moment." },
                        { status: 409 }
                    );
                }
            } catch (stripeCheckError) {
                // Expired or invalid session ID in Stripe, proceed to create a fresh one below
                console.log("Existing Stripe session unusable, creating new session:", stripeCheckError);
            }
        }

        // 8. Ensure every court has a payment record before creating the Stripe session
        //    (payments[0] is the original; a later duplicate-charge payment row can exist, 20261102)
        const baseUrl = request.nextUrl.origin;
        const lines: { sibling: BasketSibling; paymentId: string; amount: number }[] = [];

        for (const sibling of siblings) {
            const payment = sibling.payments[0];
            // Charge each court its own payment amount, the figure reconciliation checks against
            const amount = Number(payment?.amount) || sibling.total_amount || 200;
            let paymentRecordId = payment?.id;

            if (!paymentRecordId) {
                const { data: newPayment, error: createPaymentError } = await supabase
                    .from("payments")
                    .insert({
                        booking_id: sibling.id,
                        amount,
                        currency: "php",
                        status: "pending",
                    })
                    .select("id")
                    .single();

                if (createPaymentError || !newPayment) {
                    return Response.json(
                        { error: "Could not create payment record for booking." },
                        { status: 500 }
                    );
                }
                paymentRecordId = newPayment.id as string;
            }
            lines.push({ sibling, paymentId: paymentRecordId, amount });
        }

        // 9. Create one fresh Stripe Checkout Session, one line per court (same shape as /api/stripe/checkout)
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ["card"],
            line_items: lines.map(({ sibling, amount }) => ({
                price_data: {
                    currency: "php",
                    product_data: {
                        name: `${sibling.courts?.name || "Crosshair Dinkers Court"} — ${sibling.booking_date} • ${formatTime12h(toDbTime(sibling.start_time))}–${formatTime12h(toDbTime(sibling.end_time))}`,
                    },
                    unit_amount: Math.round(amount * 100),
                },
                quantity: 1,
            })),
            mode: "payment",
            success_url: `${baseUrl}/book/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${baseUrl}/book`,
            // Legacy (pre-basket) bookings keep the booking/payment metadata reconciliation expects for them
            metadata: booking.basket_id
                ? { basket_id: booking.basket_id }
                : { booking_id: booking.id, payment_id: lines[0].paymentId },
            customer_email: user.email,
            expires_at: Math.floor(Date.now() / 1000) + (33 * 60), // 3 minutes over Stripe's 30-minute minimum
        });

        // 10. Atomically confirm each hold extension under court lock and persist the new Stripe session ID
        const authoritativeHoldExpiresAtIso = new Date((session.expires_at + 120) * 1000).toISOString();

        let confirmError: { message?: string } | null = null;
        for (const { sibling, paymentId } of lines) {
            const { error } = await supabase.rpc("confirm_checkout_hold", {
                p_booking_id: sibling.id,
                p_payment_id: paymentId,
                p_stripe_session_id: session.id,
                p_hold_expires_at: authoritativeHoldExpiresAtIso,
            });
            if (error) {
                confirmError = error;
                break;
            }
        }

        if (confirmError) {
            console.error("confirm_checkout_hold RPC failed on resume:", confirmError);
            try {
                await stripe.checkout.sessions.expire(session.id);
            } catch (expireErr) {
                console.error("Failed to expire superseded Stripe session on resume:", expireErr);
            }

            // INVALID_STATUS: the expired hold was released when another player claimed the slot (20261102)
            const isConflict =
                confirmError.message?.includes("SLOT_UNAVAILABLE") || confirmError.message?.includes("INVALID_STATUS");
            if (isConflict) {
                return Response.json(
                    { error: "Your reservation hold expired and the time slot was reserved by another player. Please choose another slot." },
                    { status: 409 }
                );
            }

            return Response.json(
                { error: "Failed to extend reservation hold for checkout. Please try again." },
                { status: 500 }
            );
        }

        return Response.json({ url: session.url });
    } catch (error: unknown) {
        console.error("Resume payment error:", error);
        return Response.json(
            { error: "An unexpected error occurred while resuming payment." },
            { status: 500 }
        );
    }
}
