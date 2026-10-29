import { NextRequest } from "next/server";
import Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/supabase/service";
import {
    validateBasketLines,
    getBookingWeekday,
} from "@/lib/services/bookings/validateBookingSlot.service";
import { formatTime12h } from "@/lib/utils/formatTime";

interface HeldBasket {
    basket_id: string;
    items: { booking_id: string; payment_id: string; court_name: string; start_time: string; end_time: string; amount: number | string }[];
}

export async function POST(request: NextRequest) {
    let createdBookingIds: string[] = [];
    let createdPaymentIds: string[] = [];

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

        // 2. Parse the basket. A legacy single-court body (old bundle mid-deploy) becomes a one-line basket.
        const body = await request.json().catch(() => null);
        const booking_date = body?.booking_date;
        const lines: unknown =
            body?.lines ??
            (body?.court_id && body?.start_time && body?.end_time
                ? [{ court_id: body.court_id, start_time: body.start_time, end_time: body.end_time }]
                : undefined);

        if (typeof booking_date !== "string" || !booking_date) {
            return Response.json(
                { error: "Missing required booking details." },
                { status: 400 }
            );
        }

        // One query for every court: true names and status come from the DB for security
        const courtIds = Array.isArray(lines)
            ? lines.map((l) => l?.court_id).filter((id): id is string => typeof id === "string")
            : [];
        const { data: courts } = courtIds.length
            ? await supabase.from("courts").select("id, name, status").in("id", courtIds)
            : { data: [] };

        // Query operating hours for target date in Asia/Manila
        const dayOfWeek = getBookingWeekday(booking_date);
        const [{ data: operatingHour, error: opError }, { data: limits, error: limitsError }] = await Promise.all([
            supabase.from("operating_hours").select("is_open, open_time, close_time").eq("day_of_week", dayOfWeek).maybeSingle(),
            supabase.from("booking_settings").select("min_hours, max_hours").maybeSingle(),
        ]);

        if (opError || limitsError || !limits) {
            return Response.json(
                { error: "Failed to verify venue operating hours." },
                { status: 500 }
            );
        }

        // Server-side validation of every line: shape, one per court, whole-hour boundaries,
        // duration limits, operating hours, and past dates
        const validation = validateBasketLines({
            bookingDate: booking_date,
            lines,
            courts: courts ?? [],
            operatingHour,
            limits,
        });

        if (!validation.valid) {
            return Response.json(
                { error: validation.error },
                { status: 400 }
            );
        }

        // 3. Atomically hold every court slot (all-or-nothing) using database row locks.
        // Grant an initial 35-minute safety buffer (2100s) to guarantee the courts remain held
        // while database operations and Stripe Checkout Session creation execute.
        // Prices come from the database so Stripe charges exactly what the holds record.
        const initialHoldExpiresAtIso = new Date(Date.now() + 35 * 60 * 1000).toISOString();

        const { data: rpcResult, error: rpcError } = await supabase.rpc("hold_court_basket", {
            p_booking_date: booking_date,
            p_lines: validation.lines.map((l) => ({
                court_id: l.courtId,
                start_time: l.startTimeDb,
                end_time: l.endTimeDb,
            })),
            p_hold_expires_at: initialHoldExpiresAtIso,
        });

        if (rpcError) {
            const msg = rpcError.message ?? "";

            if (msg.includes("OPEN_BASKET_EXISTS")) {
                return Response.json(
                    { error: "You already have a reservation awaiting payment. Complete or cancel it under 'My Bookings' first." },
                    { status: 409 }
                );
            }

            if (msg.includes("SLOT_UNAVAILABLE")) {
                // The RPC names the taken line: "SLOT_UNAVAILABLE: <court> <start>–<end>"
                const taken = msg.split("SLOT_UNAVAILABLE:")[1]?.trim() || "A selected time slot";
                return Response.json(
                    { error: `${taken} was just taken. Nothing was reserved — please choose again.` },
                    { status: 409 }
                );
            }

            if (msg.includes("INVALID_DURATION")) {
                return Response.json({ error: msg.replace(/^.*INVALID_DURATION:\s*/, "") }, { status: 400 });
            }

            if (msg.includes("VENUE_CLOSED")) {
                return Response.json(
                    { error: "The venue is closed on this date." },
                    { status: 400 }
                );
            }

            if (msg.includes("COURT_UNAVAILABLE")) {
                return Response.json(
                    { error: "This court is currently not available for reservations." },
                    { status: 400 }
                );
            }

            if (msg.includes("INVALID_ARGUMENT")) {
                return Response.json({ error: "Invalid booking details." }, { status: 400 });
            }

            const isMissingRpc = rpcError.code === "42883" || rpcError.code === "PGRST202" || msg.includes("hold_court_basket");
            if (isMissingRpc) {
                console.error("Required RPC hold_court_basket is not configured in database:", rpcError);
                return Response.json(
                    { error: "Database concurrency lock (hold_court_basket) is not configured. Please ensure the required database migration has been applied." },
                    { status: 503 }
                );
            }

            console.error("hold_court_basket RPC failed:", rpcError);
            return Response.json(
                { error: "Failed to create reservation hold. Please try again." },
                { status: 500 }
            );
        }

        const basket: HeldBasket | null = typeof rpcResult === "string" ? JSON.parse(rpcResult) : rpcResult;
        const items = basket?.items ?? [];
        createdBookingIds = items.map((i) => i.booking_id);
        createdPaymentIds = items.map((i) => i.payment_id);

        if (!basket?.basket_id || items.length !== validation.lines.length || items.some((i) => !(Number(i.amount) > 0))) {
            return Response.json(
                { error: "Could not create reservation hold. Please try again." },
                { status: 500 }
            );
        }

        // 6. Create a Stripe Checkout Session
        const baseUrl = request.nextUrl.origin;

        // Stripe requires expires_at to be at least 30 minutes in the future from the moment of session creation.
        // We set 33 minutes (1980s), providing a robust 3-minute (180s) safety margin over Stripe's 30-minute minimum
        // to comfortably absorb network transit, clock skew, and DNS/TLS latency.
        const stripeExpiresAtSec = Math.floor(Date.now() / 1000) + (33 * 60);

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ["card"],
            line_items: items.map((item) => ({
                price_data: {
                    currency: "php",
                    product_data: {
                        name: `${item.court_name} — ${booking_date} • ${formatTime12h(item.start_time)}–${formatTime12h(item.end_time)}`,
                    },
                    unit_amount: Math.round(Number(item.amount) * 100), // Stripe uses cents
                },
                quantity: 1,
            })),
            mode: "payment",
            success_url: `${baseUrl}/book/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${baseUrl}/book`,
            metadata: { basket_id: basket.basket_id },
            customer_email: user.email,
            expires_at: stripeExpiresAtSec,
        });

        // 7. Atomically confirm each hold and persist the Stripe session ID.
        // Uses confirm_checkout_hold RPC under court row lock to verify that the slot was not claimed
        // if the initial hold expired while Stripe was processing (preventing expired-hold resurrection).
        const authoritativeHoldExpiresAtIso = new Date((session.expires_at + 120) * 1000).toISOString();

        let confirmError: { message?: string } | null = null;
        for (const item of items) {
            const { error } = await supabase.rpc("confirm_checkout_hold", {
                p_booking_id: item.booking_id,
                p_payment_id: item.payment_id,
                p_stripe_session_id: session.id,
                p_hold_expires_at: authoritativeHoldExpiresAtIso,
            });
            if (error) {
                confirmError = error;
                break;
            }
        }

        if (confirmError) {
            console.error("confirm_checkout_hold RPC failed:", confirmError);

            // Case A: A hold expired and another booking claimed the slot while Stripe was processing
            const isConflict = confirmError.message?.includes("SLOT_UNAVAILABLE");
            if (isConflict) {
                try {
                    await stripe.checkout.sessions.expire(session.id);
                } catch (expireErr) {
                    console.error("Failed to expire superseded Stripe session:", expireErr);
                }

                // Preserve booking records for audit (do not delete), but report conflict to player
                return Response.json(
                    { error: "Your reservation hold expired and a time slot was reserved by another player. Please choose again." },
                    { status: 409 }
                );
            }

            // Case B: Database error or network glitch after Stripe session creation
            // Do NOT delete bookings or payments (Stripe session exists). Attempt to expire session and report error.
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
        // Service role: these ids came from our own hold_court_basket call, and RLS only accepts
        // customer-labelled direct cancellations. Without the key the hold is left for cron cleanup.
        const admin = isDefinitePreCreationError ? getServiceClient() : null;
        if (isDefinitePreCreationError) {
            if (admin && createdPaymentIds.length) {
                await admin.from("payments").update({ status: "failed" }).in("id", createdPaymentIds).eq("status", "pending");
            }
            if (admin && createdBookingIds.length) {
                await admin.from("bookings")
                    .update({ status: "cancelled", cancel_reason: "checkout_failed" })
                    .in("id", createdBookingIds)
                    .eq("status", "pending");
            }
            return Response.json(
                { error: "Checkout session initialization failed. Please try again." },
                { status: 400 }
            );
        }

        // Ambiguous failure (e.g. StripeConnectionError, socket timeout, or error after sessions.create)
        if (createdBookingIds.length) {
            console.error(
                `[Checkout Ambiguous Failure] Preserving pending hold for asynchronous recovery: booking_ids=${createdBookingIds.join(",")}, payment_ids=${createdPaymentIds.join(",")}, error=${(error as Error)?.name || "Unknown"}: ${(error as Error)?.message}`
            );
            return Response.json(
                {
                    error: "A network issue occurred while connecting to payment services. Your court hold is temporarily saved. Please visit 'My Bookings' to complete your reservation or try again.",
                    bookingIds: createdBookingIds,
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
