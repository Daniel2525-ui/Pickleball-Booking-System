import { NextRequest } from "next/server";
import Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/supabase/service";
import {
    validateBookingSlot,
    getBookingWeekday,
} from "@/lib/services/bookings/validateBookingSlot.service";
import { formatTime12h } from "@/lib/utils/formatTime";

export async function POST(request: NextRequest) {
    let createdBookingId: string | null = null;
    let createdPaymentId: string | null = null;

    try {
        if (!process.env.STRIPE_SECRET_KEY) {
            return Response.json(
                { error: "Stripe is not configured. Please contact the administrator." },
                { status: 500 }
            );
        }

        // 1. Authenticate the user
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
            return Response.json(
                { error: "You must be logged in to book a court." },
                { status: 401 }
            );
        }

        // 2. Parse the booking details from the request body
        const body = await request.json();
        const { court_id, booking_date, start_time, end_time } = body;

        if (!court_id || !booking_date || !start_time || !end_time) {
            return Response.json(
                { error: "Missing required booking details." },
                { status: 400 }
            );
        }

        // Fetch true court details from DB for security
        const { data: court } = await supabase
            .from("courts")
            .select("name, status")
            .eq("id", court_id)
            .single();

        if (!court) {
            return Response.json(
                { error: "Invalid court." },
                { status: 400 }
            );
        }

        if (court.status === "maintenance" || court.status === "closed") {
            return Response.json(
                { error: "This court is currently not available for reservations." },
                { status: 400 }
            );
        }

        const court_name = court.name;

        // Query operating hours for target date in Asia/Manila
        const dayOfWeek = getBookingWeekday(booking_date);
        const { data: operatingHour, error: opError } = await supabase
            .from("operating_hours")
            .select("is_open, open_time, close_time")
            .eq("day_of_week", dayOfWeek)
            .maybeSingle();

        if (opError) {
            return Response.json(
                { error: "Failed to verify venue operating hours." },
                { status: 500 }
            );
        }

        // Server-side validation of whole-hour boundaries, duration limits, operating hours, and past dates
        const validation = validateBookingSlot({
            bookingDate: booking_date,
            startTime: start_time,
            endTime: end_time,
            operatingHour,
        });

        if (!validation.valid) {
            return Response.json(
                { error: validation.error },
                { status: 400 }
            );
        }

        const { durationHours, startTimeDb, endTimeDb, amount } = validation;

        // 3. Atomically hold the court slot using database row lock.
        // Grant an initial 35-minute safety buffer (2100s) to guarantee the court remains held
        // while database operations and Stripe Checkout Session creation execute.
        const initialHoldExpiresAtIso = new Date(Date.now() + 35 * 60 * 1000).toISOString();

        let bookingId: string | null = null;
        let paymentId: string | null = null;

        const { data: rpcResult, error: rpcError } = await supabase.rpc("hold_court_booking", {
            p_court_id: court_id,
            p_booking_date: booking_date,
            p_start_time: startTimeDb,
            p_end_time: endTimeDb,
            p_user_id: user.id,
            p_amount: amount,
            p_hold_expires_at: initialHoldExpiresAtIso,
        });

        if (rpcError) {
            const isConflict = rpcError.message?.includes("SLOT_UNAVAILABLE");
            if (isConflict) {
                return Response.json(
                    { error: "This time slot is no longer available. Please choose another." },
                    { status: 409 }
                );
            }

            const isVenueClosed = rpcError.message?.includes("VENUE_CLOSED");
            if (isVenueClosed) {
                return Response.json(
                    { error: "The venue is closed on this date." },
                    { status: 400 }
                );
            }

            if (rpcError.message?.includes("TOO_MANY_HOLDS")) {
                return Response.json(
                    { error: "You already have 3 reservations awaiting payment. Complete or cancel one under 'My Bookings' first." },
                    { status: 409 }
                );
            }

            const isCourtUnavailable = rpcError.message?.includes("COURT_UNAVAILABLE");
            if (isCourtUnavailable) {
                return Response.json(
                    { error: "This court is currently not available for reservations." },
                    { status: 400 }
                );
            }

            const isMissingRpc = rpcError.code === "42883" || rpcError.code === "PGRST202" || rpcError.message?.includes("hold_court_booking");
            if (isMissingRpc) {
                console.error("Required RPC hold_court_booking is not configured in database:", rpcError);
                return Response.json(
                    { error: "Database concurrency lock (hold_court_booking) is not configured. Please ensure the required database migration has been applied." },
                    { status: 503 }
                );
            }

            console.error("hold_court_booking RPC failed:", rpcError);
            return Response.json(
                { error: "Failed to create reservation hold. Please try again." },
                { status: 500 }
            );
        } else if (rpcResult) {
            const parsed = typeof rpcResult === "string" ? JSON.parse(rpcResult) : rpcResult;
            bookingId = parsed.booking_id;
            paymentId = parsed.payment_id;
        }

        if (!bookingId || !paymentId) {
            return Response.json(
                { error: "Could not create reservation hold. Please try again." },
                { status: 500 }
            );
        }

        createdBookingId = bookingId;
        createdPaymentId = paymentId;

        // 6. Create a Stripe Checkout Session
        const baseUrl = request.nextUrl.origin;

        // Stripe requires expires_at to be at least 30 minutes in the future from the moment of session creation.
        // We set 33 minutes (1980s), providing a robust 3-minute (180s) safety margin over Stripe's 30-minute minimum
        // to comfortably absorb network transit, clock skew, and DNS/TLS latency.
        const stripeExpiresAtSec = Math.floor(Date.now() / 1000) + (33 * 60);

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ["card"],
            line_items: [
                {
                    price_data: {
                        currency: "php",
                        product_data: {
                            name: `${court_name} — Court Booking (${durationHours} ${durationHours === 1 ? "Hour" : "Hours"})`,
                            description: `${booking_date} • ${formatTime12h(startTimeDb)} – ${formatTime12h(endTimeDb)}`,
                        },
                        unit_amount: Math.round(amount * 100), // Stripe uses cents
                    },
                    quantity: 1,
                },
            ],
            mode: "payment",
            success_url: `${baseUrl}/book/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${baseUrl}/book`,
            metadata: {
                booking_id: bookingId,
                payment_id: paymentId,
            },
            customer_email: user.email,
            expires_at: stripeExpiresAtSec,
        });

        // 7. Atomically confirm hold and persist Stripe session ID.
        // Uses confirm_checkout_hold RPC under court row lock to verify that the slot was not claimed
        // if the initial hold expired while Stripe was processing (preventing expired-hold resurrection).
        const authoritativeHoldExpiresAtIso = new Date((session.expires_at + 120) * 1000).toISOString();

        const { error: confirmError } = await supabase.rpc("confirm_checkout_hold", {
            p_booking_id: bookingId,
            p_payment_id: paymentId,
            p_stripe_session_id: session.id,
            p_hold_expires_at: authoritativeHoldExpiresAtIso,
        });

        if (confirmError) {
            console.error("confirm_checkout_hold RPC failed:", confirmError);

            // Case A: The initial hold expired and another booking claimed the slot while Stripe was processing
            const isConflict = confirmError.message?.includes("SLOT_UNAVAILABLE");
            if (isConflict) {
                try {
                    await stripe.checkout.sessions.expire(session.id);
                } catch (expireErr) {
                    console.error("Failed to expire superseded Stripe session:", expireErr);
                }

                // Preserve booking record for audit (do not delete), but report conflict to player
                return Response.json(
                    { error: "Your reservation hold expired and the time slot was reserved by another player. Please choose another slot." },
                    { status: 409 }
                );
            }

            // Case B: Database error or network glitch after Stripe session creation
            // Do NOT delete booking or payment (Stripe session exists). Attempt to expire session and report error.
            try {
                await stripe.checkout.sessions.expire(session.id);
            } catch (expireErr) {
                console.error("Failed to expire Stripe session on DB failure:", expireErr);
            }

            return Response.json(
                { error: "Unable to confirm court reservation hold. If payment was initiated, your booking will be preserved under 'My Bookings'." },
                { status: 500 }
            );
        }

        return Response.json({ url: session.url });
    } catch (error: unknown) {
        console.error("Checkout session error:", error);

        const isDefinitePreCreationError =
            error instanceof Stripe.errors.StripeInvalidRequestError ||
            error instanceof Stripe.errors.StripeAuthenticationError ||
            error instanceof Stripe.errors.StripePermissionError ||
            Boolean((error as Error)?.message?.includes("Stripe is not configured"));

        // Only release records on definite pre-creation failure where no session could exist at Stripe.
        // For network timeouts or connection drops, preserve pending records so payment resumption,
        // webhooks, or cron cleanup can safely resolve them without dropping paid bookings.
        // Service role: these ids came from our own hold_court_booking call, and RLS only accepts
        // customer-labelled direct cancellations. Without the key the hold is left for cron cleanup.
        const admin = isDefinitePreCreationError ? getServiceClient() : null;
        if (isDefinitePreCreationError) {
            if (admin && createdPaymentId) {
                await admin.from("payments").update({ status: "failed" }).eq("id", createdPaymentId).eq("status", "pending");
            }
            if (admin && createdBookingId) {
                await admin.from("bookings")
                    .update({ status: "cancelled", cancel_reason: "checkout_failed" })
                    .eq("id", createdBookingId)
                    .eq("status", "pending");
            }
            return Response.json(
                { error: "Checkout session initialization failed. Please try again." },
                { status: 400 }
            );
        }

        // Ambiguous failure (e.g. StripeConnectionError, socket timeout, or error after sessions.create)
        if (createdBookingId) {
            console.error(
                `[Checkout Ambiguous Failure] Preserving pending hold for asynchronous recovery: booking_id=${createdBookingId}, payment_id=${createdPaymentId}, error=${(error as Error)?.name || "Unknown"}: ${(error as Error)?.message}`
            );
            return Response.json(
                {
                    error: "A network issue occurred while connecting to payment services. Your court hold is temporarily saved. Please visit 'My Bookings' to complete your reservation or try again.",
                    bookingId: createdBookingId,
                },
                { status: 500 }
            );
        }

        return Response.json(
            { error: "An unexpected error occurred. Please try again." },
            { status: 500 }
        );
    }
}
