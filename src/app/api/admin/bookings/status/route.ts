import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe";
import { canTransition, noShowMinutesLeft, buildStatusUpdate } from "@/lib/services/bookings/adminStatusRules";
import {
    type BasketSibling,
    loadPendingSiblings,
    pendingPaymentIds,
    siblingSessionIds,
} from "@/lib/services/bookings/basketSiblings";

export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient();

        // 1. Admin-only
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return Response.json({ error: "Unauthorized." }, { status: 401 });
        }

        const { data: profile } = await supabase
            .from("profiles")
            .select("role")
            .eq("id", user.id)
            .maybeSingle();

        if (profile?.role !== "admin") {
            return Response.json({ error: "Admin access required." }, { status: 403 });
        }

        // 2. Validate body
        const body = await request.json().catch(() => null);
        const bookingId = typeof body?.bookingId === "string" ? body.bookingId.trim() : "";
        const newStatus = typeof body?.status === "string" ? body.status.trim().toLowerCase() : "";

        if (!bookingId || !newStatus) {
            return Response.json({ error: "bookingId and status are required." }, { status: 400 });
        }

        // 3. Load current booking
        const { data: booking, error: fetchError } = await supabase
            .from("bookings")
            .select("id, status, booking_date, start_time, hold_expires_at, created_at, basket_id")
            .eq("id", bookingId)
            .maybeSingle();

        if (fetchError) {
            console.error("Status update: fetch error:", fetchError);
            return Response.json({ error: "Failed to load booking." }, { status: 500 });
        }
        if (!booking) {
            return Response.json({ error: "Booking not found." }, { status: 404 });
        }

        const currentStatus = booking.status.toLowerCase();

        // 4. Validate transition
        if (!canTransition(currentStatus, newStatus)) {
            return Response.json(
                { error: `Cannot transition from "${currentStatus}" to "${newStatus}".` },
                { status: 409 }
            );
        }

        // 5. No-show grace period guard
        if (newStatus === "no_show") {
            const minutesLeft = noShowMinutesLeft(booking);
            if (minutesLeft > 0) {
                return Response.json(
                    { error: `No-show grace period has not elapsed. ${minutesLeft} minute(s) remaining.` },
                    { status: 409 }
                );
            }
        }

        // 6. An unpaid basket is cancelled as one unit. Its shared Stripe Checkout may be open: close it
        //    first, and stop if that fails, so nobody pays for a cancelled booking (same rule as /api/bookings/cancel).
        let siblings: BasketSibling[] = [];
        if (newStatus === "cancelled" && currentStatus === "pending") {
            const loaded = await loadPendingSiblings(supabase, booking);
            if (loaded.error) {
                console.error("Admin cancel: failed to load basket:", loaded.error);
                return Response.json({ error: "Could not verify the payment for this booking." }, { status: 500 });
            }
            siblings = loaded.siblings;

            for (const sessionId of siblingSessionIds(siblings)) {
                try {
                    const session = await stripe.checkout.sessions.retrieve(sessionId);
                    if (session.status === "complete") {
                        return Response.json(
                            { error: "The customer has already paid for this booking. Refresh to see its confirmed status." },
                            { status: 409 }
                        );
                    }
                    if (session.status === "open") {
                        await stripe.checkout.sessions.expire(sessionId);
                    }
                } catch (stripeErr) {
                    console.error("Admin cancel: failed to expire Stripe session:", stripeErr);
                    return Response.json(
                        { error: "Could not close the customer's payment session. Please try again." },
                        { status: 502 }
                    );
                }
            }
        }

        // 7. Conditional update (optimistic lock on current status) with Stage 2 audit timestamps
        const updatePayload = buildStatusUpdate(newStatus, booking);

        const { data: updated, error: updateError } = await supabase
            .from("bookings")
            .update(updatePayload)
            .eq("id", bookingId)
            .eq("status", booking.status)
            .select("id, status, checked_in_at, started_at, completed_at, no_show_at")
            .maybeSingle();

        if (updateError) {
            console.error("Status update error:", updateError);
            if (updateError.code === "23514" || updateError.message?.includes("check constraint")) {
                return Response.json(
                    { error: `Status "${newStatus}" is not permitted by database check constraints until Stage 2 migration is applied.` },
                    { status: 422 }
                );
            }
            return Response.json({ error: "Failed to update status." }, { status: 500 });
        }

        if (!updated) {
            return Response.json(
                { error: "Booking was updated concurrently. Please refresh and try again." },
                { status: 409 }
            );
        }

        // The rest of the unpaid basket; a court changed meanwhile is left alone
        const cancelled = siblings.filter((s) => s.id === booking.id);
        for (const sibling of siblings.filter((s) => s.id !== booking.id)) {
            const { data: done, error } = await supabase
                .from("bookings")
                .update(buildStatusUpdate("cancelled", sibling))
                .eq("id", sibling.id)
                .eq("status", "pending")
                .select("id")
                .maybeSingle();
            if (error) console.error(`Admin cancel: failed to cancel basket court ${sibling.id}:`, error);
            else if (done) cancelled.push(sibling);
        }

        const failedPaymentIds = pendingPaymentIds(cancelled);
        if (failedPaymentIds.length) {
            const { error: paymentUpdateError } = await supabase
                .from("payments")
                .update({ status: "failed" })
                .in("id", failedPaymentIds)
                .eq("status", "pending");

            if (paymentUpdateError) {
                // The booking itself is cancelled; log so the payment row can be reconciled.
                console.error("Admin cancel: failed to mark payment failed:", paymentUpdateError);
            }
        }

        return Response.json({ booking: updated });
    } catch (error) {
        console.error("Status update error:", error);
        return Response.json({ error: "Unexpected error." }, { status: 500 });
    }
}
