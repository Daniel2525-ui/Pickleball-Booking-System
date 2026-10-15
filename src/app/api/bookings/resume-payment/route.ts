import { NextRequest } from "next/server";
import { stripe } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import { getBookingStart } from "@/lib/services/bookings/cancelBooking.service";

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
            .select(`
                id,
                user_id,
                court_id,
                booking_date,
                start_time,
                end_time,
                status,
                total_amount,
                courts (
                    name
                )
            `)
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

        // 5. Check if the scheduled match time has already passed
        const startInstant = getBookingStart(booking);
        if (startInstant <= new Date()) {
            return Response.json(
                { error: "The scheduled match time has already passed." },
                { status: 409 }
            );
        }

        // 6. Check for double booking conflicts with confirmed bookings
        const startTimeDb = booking.start_time.length === 5 ? `${booking.start_time}:00` : booking.start_time;
        const endTimeDb = booking.end_time.length === 5 ? `${booking.end_time}:00` : booking.end_time;

        const { data: conflicts } = await supabase
            .from("bookings")
            .select("id")
            .eq("court_id", booking.court_id)
            .eq("booking_date", booking.booking_date)
            .neq("id", booking.id)
            .in("status", ["confirmed", "completed", "ongoing"])
            .lt("start_time", endTimeDb)
            .gt("end_time", startTimeDb);

        if (conflicts && conflicts.length > 0) {
            return Response.json(
                { error: "This time slot is no longer available. Please choose another slot." },
                { status: 409 }
            );
        }

        // 7. Check existing payment record
        const { data: payment, error: paymentError } = await supabase
            .from("payments")
            .select("id, status, stripe_session_id, amount")
            .eq("booking_id", booking.id)
            .maybeSingle();

        if (paymentError) {
            console.error("Resume payment: failed to load payment:", paymentError);
            return Response.json(
                { error: "Could not load payment record. Please try again." },
                { status: 500 }
            );
        }

        // If the Stripe session is already open and valid, reuse it
        if (payment?.stripe_session_id) {
            try {
                const existingSession = await stripe.checkout.sessions.retrieve(
                    payment.stripe_session_id
                );

                if (existingSession.status === "open" && existingSession.url) {
                    return Response.json({ url: existingSession.url });
                }
            } catch (stripeCheckError) {
                // Expired or invalid session ID in Stripe, proceed to create a fresh one below
                console.log("Existing Stripe session unusable, creating new session:", stripeCheckError);
            }
        }

        // 8. Create a fresh Stripe Checkout Session for this exact booking
        const baseUrl = request.nextUrl.origin;
        const amount = booking.total_amount || payment?.amount || 200;
        const courtName = (booking.courts as any)?.name || "Crosshair Dinkers Court";
        const paymentRecordId = payment?.id;

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ["card"],
            line_items: [
                {
                    price_data: {
                        currency: "php",
                        product_data: {
                            name: `${courtName} — Court Booking`,
                            description: `${booking.booking_date} • ${booking.start_time.slice(0, 5)} – ${booking.end_time.slice(0, 5)}`,
                        },
                        unit_amount: Math.round(amount * 100),
                    },
                    quantity: 1,
                },
            ],
            mode: "payment",
            success_url: `${baseUrl}/book/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${baseUrl}/book`,
            metadata: {
                booking_id: booking.id,
                payment_id: paymentRecordId || "",
            },
            customer_email: user.email,
            expires_at: Math.floor(Date.now() / 1000) + (30 * 60), // Valid for 30 minutes
        });

        // 9. Update the payment record with the new stripe_session_id
        if (paymentRecordId) {
            await supabase
                .from("payments")
                .update({
                    stripe_session_id: session.id,
                    status: "pending",
                })
                .eq("id", paymentRecordId);
        } else {
            // In case no payment row existed yet
            await supabase.from("payments").insert({
                booking_id: booking.id,
                amount,
                currency: "php",
                status: "pending",
                stripe_session_id: session.id,
            });
        }

        return Response.json({ url: session.url });
    } catch (error: any) {
        console.error("Resume payment error:", error);
        return Response.json(
            { error: error.message || "An unexpected error occurred while resuming payment." },
            { status: 500 }
        );
    }
}
