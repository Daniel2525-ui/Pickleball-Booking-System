import { NextRequest } from "next/server";
import { stripe } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import {
    CANCELLED_STATUS,
    getCancellationBlockReason,
} from "@/lib/services/bookings/cancelBooking.service";

/**
 * Customer-initiated booking cancellation.
 *
 * Security: RLS is currently disabled on public.bookings, so ownership and the
 * allowed status transition are enforced here, using the authenticated user from
 * the session cookie (never a user id supplied by the client).
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
            .select("id, user_id, booking_date, start_time, status")
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
        const blockReason = getCancellationBlockReason(booking);
        if (blockReason) {
            return Response.json({ error: blockReason }, { status: 409 });
        }

        const currentStatus = booking.status.toLowerCase();

        // 5. Pending bookings may still have an open Stripe Checkout session.
        //    Expire it first so the customer cannot pay for a cancelled booking.
        let pendingPaymentId: string | null = null;

        if (currentStatus === "pending") {
            const { data: payment, error: paymentError } = await supabase
                .from("payments")
                .select("id, status, stripe_session_id")
                .eq("booking_id", booking.id)
                .maybeSingle();

            if (paymentError) {
                console.error("Cancel booking: failed to load payment:", paymentError);
                return Response.json({ error: "Could not verify the payment for this booking. Please try again." }, { status: 500 });
            }

            if (payment?.status === "pending") pendingPaymentId = payment.id;

            if (payment?.stripe_session_id) {
                try {
                    const session = await stripe.checkout.sessions.retrieve(payment.stripe_session_id);

                    if (session.status === "complete") {
                        // Payment already went through; the webhook will confirm the booking.
                        return Response.json(
                            { error: "Payment for this booking has already been received and is being processed. Please refresh the page and try again." },
                            { status: 409 }
                        );
                    }

                    if (session.status === "open") {
                        await stripe.checkout.sessions.expire(payment.stripe_session_id);
                    }
                } catch (stripeError) {
                    console.error("Cancel booking: failed to expire Stripe session:", stripeError);
                    return Response.json(
                        { error: "Could not close the pending payment session. Please try again." },
                        { status: 502 }
                    );
                }
            }
        }

        // 6. Conditional update: only succeeds if the booking still belongs to the user
        //    and still has the status we validated (guards against races / double clicks).
        const { data: updated, error: updateError } = await supabase
            .from("bookings")
            .update({ status: CANCELLED_STATUS })
            .eq("id", booking.id)
            .eq("user_id", user.id)
            .eq("status", booking.status)
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

        // 7. Mirror the existing cron cleanup: an unpaid (pending) payment is marked cancelled.
        //    Paid payments are left untouched; refunds are handled manually by an admin.
        if (pendingPaymentId) {
            const { error: paymentUpdateError } = await supabase
                .from("payments")
                .update({ status: CANCELLED_STATUS })
                .eq("id", pendingPaymentId)
                .eq("status", "pending");

            if (paymentUpdateError) {
                // The booking itself is cancelled; log so an admin can reconcile the payment row.
                console.error("Cancel booking: failed to mark payment cancelled:", paymentUpdateError);
            }
        }

        return Response.json({ booking: updated });
    } catch (error) {
        console.error("Cancel booking error:", error);
        return Response.json({ error: "An unexpected error occurred. Please try again." }, { status: 500 });
    }
}
