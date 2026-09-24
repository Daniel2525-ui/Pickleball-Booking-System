import { NextRequest } from "next/server";
import { stripe } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";

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
            .select("name")
            .eq("id", court_id)
            .single();

        if (!court) {
            return Response.json(
                { error: "Invalid court." },
                { status: 400 }
            );
        }

        const court_name = court.name;
        // Calculate price dynamically (Premium courts: $20, Standard: $15)
        const amount = court_name.includes("Premium") ? 2000 : 1500;

        // Ensure times have seconds for accurate DB string comparison (e.g. '08:00:00' vs '08:00')
        const startTimeDb = start_time.length === 5 ? `${start_time}:00` : start_time;
        const endTimeDb = end_time.length === 5 ? `${end_time}:00` : end_time;

        // 3. Check court availability (no overlapping confirmed bookings)
        const { data: conflicts } = await supabase
            .from("bookings")
            .select("id")
            .eq("court_id", court_id)
            .eq("booking_date", booking_date)
            .eq("status", "confirmed")
            .lt("start_time", endTimeDb)
            .gt("end_time", startTimeDb);

        if (conflicts && conflicts.length > 0) {
            return Response.json(
                { error: "This time slot is no longer available. Please choose another." },
                { status: 409 }
            );
        }

        // 4. Create a pending booking in Supabase
        const { data: booking, error: bookingError } = await supabase
            .from("bookings")
            .insert({
                user_id: user.id,
                court_id,
                booking_date,
                start_time: startTimeDb,
                end_time: endTimeDb,
                status: "pending",
                total_amount: amount,
            })
            .select("id")
            .single();

        if (bookingError || !booking) {
            console.error("Failed to create booking:", bookingError);
            return Response.json(
                { error: "Failed to create booking. Please try again." },
                { status: 500 }
            );
        }

        createdBookingId = booking.id;

        // 5. Create a pending payment record in Supabase
        const { data: payment, error: paymentError } = await supabase
            .from("payments")
            .insert({
                booking_id: booking.id,
                amount,
                currency: "php",
                status: "pending",
            })
            .select("id")
            .single();

        if (paymentError || !payment) {
            console.error("Failed to create payment:", paymentError);
            // Clean up the booking we just created
            await supabase.from("bookings").delete().eq("id", booking.id);
            return Response.json(
                { error: "Failed to create payment record. Please try again." },
                { status: 500 }
            );
        }

        createdPaymentId = payment.id;

        // 6. Create a Stripe Checkout Session
        const baseUrl = request.nextUrl.origin;

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ["card"],
            line_items: [
                {
                    price_data: {
                        currency: "php",
                        product_data: {
                            name: `${court_name} — Court Booking`,
                            description: `${booking_date} • ${start_time} – ${end_time}`,
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
                booking_id: booking.id,
                payment_id: payment.id,
            },
            customer_email: user.email,
            expires_at: Math.floor(Date.now() / 1000) + (30 * 60), // Expires in exactly 30 minutes
        });

        // 7. Store the Stripe session ID on the payment record
        await supabase
            .from("payments")
            .update({ stripe_session_id: session.id })
            .eq("id", payment.id);

        return Response.json({ url: session.url });
    } catch (error: any) {
        console.error("Checkout session error:", error);

        // Clean up the pending records since we couldn't redirect to Stripe
        const supabase = await createClient(); // Need a fresh client for catch block
        if (createdPaymentId) {
            await supabase.from("payments").delete().eq("id", createdPaymentId);
        }
        if (createdBookingId) {
            await supabase.from("bookings").delete().eq("id", createdBookingId);
        }

        return Response.json(
            { error: error.message || "An unexpected error occurred. Please try again." },
            { status: 500 }
        );
    }
}
