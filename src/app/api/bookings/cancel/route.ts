import { NextRequest } from "next/server";
import { fetchBookingPolicy } from "@/lib/services/settings/bookingPolicy";
import { createClient } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/supabase/service";
import { refundPaidStripePayments } from "@/lib/services/payments/refundPaidStripePayments.ts";
import { cancelReasonFor } from "@/lib/services/bookings/bookingDisplayStatus";
import {
    CANCELLED_STATUS,
    getCancellationBlockReason,
} from "@/lib/services/bookings/cancelBooking.service";
import { type BasketSibling, loadPendingSiblings } from "@/lib/services/bookings/basketSiblings";
import { cancelRestOfBasket, closeSiblingSessions } from "@/lib/services/bookings/cancelPendingBasket";

/**
 * Customer-initiated booking cancellation.
 *
 * Security: ownership, the 2-hour cutoff and the refund are enforced here, using the
 * authenticated user from the session cookie (never a user id supplied by the client).
 * RLS stops customers from cancelling confirmed bookings directly, around this route.
 */
export async function POST(request: NextRequest) {
    try {
        // 1. Authenticate the user from the session cookie
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
            return Response.json({ error: "You must be logged in to cancel a booking." }, { status: 401 });
        }

        // 2. Validate input
        const body = await request.json().catch(() => null);
        const bookingId = typeof body?.bookingId === "string" ? body.bookingId.trim() : "";

        if (!bookingId) {
            return Response.json({ error: "Missing booking ID." }, { status: 400 });
        }

        // 3. Load the booking, scoped to the current user. Another customer's booking
        //    is indistinguishable from a non-existent one.
        const { data: booking, error: fetchError } = await supabase
            .from("bookings")
            .select("id, user_id, booking_date, start_time, status, hold_expires_at, created_at, basket_id")
            .eq("id", bookingId)
            .eq("user_id", user.id)
            .maybeSingle();

        if (fetchError) {
            console.error("Cancel booking: failed to load booking:", fetchError);
            return Response.json({ error: "Could not load the booking. Please try again." }, { status: 500 });
        }

        if (!booking) {
            return Response.json({ error: "Booking not found." }, { status: 404 });
        }

        // 4. Enforce business rules (status + start time not yet passed)
        const { cancelCutoffHours } = await fetchBookingPolicy(supabase);
        const blockReason = getCancellationBlockReason(booking, new Date(), cancelCutoffHours);
        if (blockReason) {
            return Response.json({ error: blockReason }, { status: 409 });
        }

        const currentStatus = booking.status.toLowerCase();

        // Service role because RLS only lets customers cancel unpaid holds directly; confirmed
        // bookings must go through this route so the cutoff and refund always apply.
        const admin = getServiceClient();
        if (!admin) {
            console.error("Cancel booking: SUPABASE_SERVICE_ROLE_KEY missing");
            return Response.json({ error: "Cancellation is temporarily unavailable. Please contact the venue." }, { status: 500 });
        }

        // 5. An unpaid basket is cancelled as one unit: every pending court of this user's basket.
        //    Its shared Stripe Checkout may still be open; expire it first so nobody pays for a cancelled booking.
        let siblings: BasketSibling[] = [];

        if (currentStatus === "pending") {
            const loaded = await loadPendingSiblings(admin, booking, user.id);
            if (loaded.error) {
                console.error("Cancel booking: failed to load basket:", loaded.error);
                return Response.json({ error: "Could not verify the payment for this booking. Please try again." }, { status: 500 });
            }
            siblings = loaded.siblings;

            try {
                if ((await closeSiblingSessions(siblings)) === "paid") {
                    // Payment already went through; the webhook will confirm the booking.
                    return Response.json(
                        { error: "Payment for this booking has already been received and is being processed. Please refresh the page and try again." },
                        { status: 409 }
                    );
                }
            } catch (stripeError) {
                console.error("Cancel booking: failed to expire Stripe session:", stripeError);
                return Response.json(
                    { error: "Could not close the pending payment session. Please try again." },
                    { status: 502 }
                );
            }
        }

        // 6. Conditional update: only succeeds if the booking still belongs to the user
        //    and still has the status we validated (guards against races / double clicks).
        const { data: updated, error: updateError } = await admin
            .from("bookings")
            .update({ status: CANCELLED_STATUS, cancel_reason: cancelReasonFor(booking, "customer") })
            .eq("id", booking.id)
            .eq("user_id", user.id)
            .eq("status", booking.status)
            // A GCash proof submitted meanwhile makes the hold infinite: staff decide then (.or keeps NULL holds)
            .or("hold_expires_at.is.null,hold_expires_at.neq.infinity")
            .select("id, status")
            .maybeSingle();

        if (updateError) {
            console.error("Cancel booking: update failed:", updateError);
            return Response.json({ error: "Failed to cancel the booking. Please try again." }, { status: 500 });
        }

        if (!updated) {
            return Response.json(
                { error: "This booking was updated by someone else. Please refresh the page to see its current status." },
                { status: 409 }
            );
        }

        // 7. The rest of the unpaid basket, each with its own reason; pending payments are marked failed
        await cancelRestOfBasket(
            admin,
            booking.id,
            siblings,
            (s) => ({ status: CANCELLED_STATUS, cancel_reason: cancelReasonFor(s, "customer") }),
            user.id
        );

        // 8. Venue policy: a confirmed online booking cancelled within the window is refunded in full.
        const refund = currentStatus === "confirmed" ? await refundPaidStripePayments(admin, booking.id, { reason: "CUSTOMER_CANCELLED_WITHIN_POLICY", keyPrefix: "ref_customer_cancel_" }) : null;

        return Response.json({ booking: updated, refund });
    } catch (error) {
        console.error("Cancel booking error:", error);
        return Response.json({ error: "An unexpected error occurred. Please try again." }, { status: 500 });
    }
}
