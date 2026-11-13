import { NextRequest } from "next/server";
import { HOLD_MS } from "@/lib/services/bookings/bookingDisplayStatus";
import Stripe from "stripe";
import { createClient } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/supabase/service";
import { heldOnTheirDates, validateBasketLines } from "@/lib/services/bookings/validateBookingSlot.service";

// Thrown when the database held lines on other dates than sent (an older hold_court_basket): the holds are released
const HOLD_DATES_MISMATCH = "HOLD_DATES_MISMATCH";
import { businessDayWindows } from "@/lib/services/schedule/hoursRules";
import { openBasketCheckout, QR_PH_NOT_CONFIGURED } from "@/lib/services/payments/openBasketCheckout";
import { MAX_SESSION_PAYMENTS } from "@/lib/services/payments/reconcileCheckoutSession";
import { checkPlayerCount, maxPlayers, parseGuestDetails } from "@/lib/services/bookings/guestDetails";
import { normaliseCode } from "@/lib/services/pricing/discounts";
import { AUTH_LIMITS, checkRateLimit, clientIp, tooManyRequests } from "@/lib/rateLimit";
import { xenditRefused } from "@/lib/xendit";

interface HeldBasket {
    basket_id: string;
    items: { booking_id: string; payment_id: string; court_id: string; court_name: string; booking_date?: string; start_time: string; end_time: string; amount: number | string }[];
}

export async function POST(request: NextRequest) {
    let createdBookingIds: string[] = [];
    let createdPaymentIds: string[] = [];

    try {
        if (!process.env.STRIPE_SECRET_KEY && !process.env.XENDIT_SECRET_KEY) {
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

        // 2. Parse the basket
        const body = await request.json().catch(() => null);
        const booking_date = body?.booking_date;
        const lines: unknown = body?.lines;
        const playerCount: unknown = body?.player_count;
        const rawCode = typeof body?.discount_code === "string" ? body.discount_code.trim() : "";
        const discountCode = rawCode ? normaliseCode(rawCode) : null;
        if (rawCode && !discountCode) {
            return Response.json({ error: "There is no such code." }, { status: 400 });
        }

        // A guest pays on an anonymous session: their details go on a guest profile (the confirmation email's
        // address, and what the front desk sees). A signed-in player's profile is never touched here.
        const isGuest = !!user.is_anonymous;
        let guestEmail: string | null = null;
        if (isGuest) {
            const limit = await checkRateLimit(`guest-checkout:ip:${clientIp(request)}`, AUTH_LIMITS.guestCheckoutsPerIp);
            if (!limit.allowed) return tooManyRequests("guest checkouts from this network", limit.retryAfterSeconds);
            const guest = parseGuestDetails(body?.guest);
            if (!guest.ok) return Response.json({ error: guest.error }, { status: 400 });
            const admin = getServiceClient();
            if (!admin) {
                console.error("Guest checkout needs SUPABASE_SERVICE_ROLE_KEY to save the guest's details");
                return Response.json({ error: "Guest checkout is not available right now. Please sign in to book." }, { status: 503 });
            }
            const { error: profileError } = await admin
                .from("profiles")
                .upsert({ id: user.id, role: "customer", is_guest: true, ...guest.value }, { onConflict: "id" });
            if (profileError) {
                console.error("Guest profile save failed:", profileError);
                return Response.json({ error: "Could not save your details. Please try again." }, { status: 500 });
            }
            guestEmail = guest.value.email;
        }

        if (typeof booking_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(booking_date) || Number.isNaN(Date.parse(booking_date))) {
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

        // The whole week: the business day's after-midnight hours come from its row but sit on the next date
        const [{ data: weeklyHours, error: opError }, { data: limits, error: limitsError }] = await Promise.all([
            supabase.from("operating_hours").select("day_of_week, is_open, open_time, close_time"),
            supabase.from("booking_settings").select("min_hours, max_players_per_court").maybeSingle(),
        ]);

        if (opError || limitsError || !limits) {
            return Response.json(
                { error: "Failed to verify venue operating hours." },
                { status: 500 }
            );
        }

        // Server-side validation of every line: shape, its date within this business day, whole-hour boundaries,
        // duration limits (a run across midnight counts as one), operating hours, and past dates
        const validation = validateBasketLines({
            bookingDate: booking_date,
            lines,
            courts: courts ?? [],
            windows: businessDayWindows(booking_date, weeklyHours ?? []),
            limits,
        });

        if (!validation.valid) {
            return Response.json(
                { error: validation.error },
                { status: 400 }
            );
        }

        // One count for the checkout, at most the per-court limit times its courts (hold_court_basket checks it too)
        const playerError = checkPlayerCount(
            playerCount,
            maxPlayers(limits.max_players_per_court ?? 8, new Set(validation.lines.map((l) => l.courtId)).size)
        );
        if (playerError) return Response.json({ error: playerError }, { status: 400 });

        // Every payment id must fit in the session's metadata, which reconciliation trusts
        if (validation.lines.length > MAX_SESSION_PAYMENTS) {
            return Response.json(
                { error: `A booking can include at most ${MAX_SESSION_PAYMENTS} time slots.` },
                { status: 400 }
            );
        }

        // 3. Atomically hold every court slot (all-or-nothing) using database row locks.
        // Grant the initial 15-minute hold to guarantee the courts remain held
        // while database operations and Stripe Checkout Session creation execute.
        // Prices come from the database so Stripe charges exactly what the holds record.
        const initialHoldExpiresAtIso = new Date(Date.now() + HOLD_MS).toISOString();

        const { data: rpcResult, error: rpcError } = await supabase.rpc("hold_court_basket", {
            p_booking_date: booking_date,
            p_lines: validation.lines.map((l) => ({
                court_id: l.courtId,
                booking_date: l.bookingDate,
                start_time: l.startTimeDb,
                end_time: l.endTimeDb,
            })),
            p_hold_expires_at: initialHoldExpiresAtIso,
            p_player_count: playerCount,
            p_discount_code: discountCode,
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

            if (msg.includes("DISCOUNT_INVALID")) {
                return Response.json({ error: msg.replace(/^.*DISCOUNT_INVALID:\s*/, "") }, { status: 400 });
            }

            if (msg.includes("INVALID_PLAYER_COUNT")) {
                return Response.json({ error: msg.replace(/^.*INVALID_PLAYER_COUNT:\s*/, "") + "." }, { status: 400 });
            }

            if (msg.includes("INVALID_DURATION")) {
                return Response.json({ error: msg.replace(/^.*INVALID_DURATION:\s*/, "") }, { status: 400 });
            }

            if (msg.includes("OUTSIDE_OPERATING_HOURS")) {
                return Response.json({ error: "The selected time range falls outside venue operating hours." }, { status: 400 });
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

        if (!heldOnTheirDates(validation.lines, items)) {
            console.error("hold_court_basket ignored line dates: apply migration 20261112133703_late_night_basket");
            throw new Error(HOLD_DATES_MISMATCH);
        }

        // 4. One QR Ph payment for every held court, each hold tied to it under the court lock
        const { url, confirmError } = await openBasketCheckout({
            supabase,
            basketId: basket.basket_id,
            customerEmail: guestEmail ?? user.email,
            baseUrl: request.nextUrl.origin,
            lines: items.map((item) => ({
                bookingId: item.booking_id,
                paymentId: item.payment_id,
                courtName: item.court_name,
                bookingDate: item.booking_date!,
                startTime: item.start_time,
                endTime: item.end_time,
                amount: Number(item.amount),
            })),
        });

        if (confirmError) {
            // Booking records are kept for audit; the session was expired so nobody pays for them
            if (confirmError.message?.includes("SLOT_UNAVAILABLE")) {
                return Response.json(
                    { error: "Your reservation hold expired and a time slot was reserved by another player. Please choose again." },
                    { status: 409 }
                );
            }
            return Response.json(
                { error: "Unable to confirm court reservation hold. If payment was initiated, your booking will be preserved under 'My Bookings'." },
                { status: 500 }
            );
        }

        return Response.json({ url });
    } catch (error: unknown) {
        console.error("Checkout session error:", error);

        const isDefinitePreCreationError =
            error instanceof Stripe.errors.StripeInvalidRequestError ||
            error instanceof Stripe.errors.StripeAuthenticationError ||
            error instanceof Stripe.errors.StripePermissionError ||
            Boolean((error as Error)?.message?.includes("Stripe is not configured")) ||
            (error as Error)?.message === QR_PH_NOT_CONFIGURED ||
            (error as Error)?.message === HOLD_DATES_MISMATCH ||
            xenditRefused(error);

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
