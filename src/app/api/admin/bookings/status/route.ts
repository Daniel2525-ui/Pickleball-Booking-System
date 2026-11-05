import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/supabase/server";
import { canTransition, noShowMinutesLeft, buildStatusUpdate, gameDayBlockReason } from "@/lib/services/bookings/adminStatusRules";
import { type BasketSibling, loadPendingSiblings } from "@/lib/services/bookings/basketSiblings";
import { cancelRestOfBasket, closeSiblingSessions } from "@/lib/services/bookings/cancelPendingBasket";

export async function POST(request: NextRequest) {
    try {
        const { supabase, denied } = await requireAdmin();
        if (denied) return denied;

        // 2. Validate body
        const body = await request.json().catch(() => null);
        const bookingId = typeof body?.bookingId === "string" ? body.bookingId.trim() : "";
        const newStatus = typeof body?.status === "string" ? body.status.trim().toLowerCase() : "";
        // Case by case: staff may cancel a paid booking and keep the payment (no refund owed), with a reason
        const keepPayment = newStatus === "cancelled" && body?.keepPayment === true;
        const cancelNote = typeof body?.note === "string" ? body.note.trim() : "";
        if (keepPayment && (!cancelNote || cancelNote.length > 200)) {
            return Response.json({ error: "Write a short reason for keeping the payment (up to 200 characters)." }, { status: 400 });
        }

        if (!bookingId || !newStatus) {
            return Response.json({ error: "bookingId and status are required." }, { status: 400 });
        }

        // 3. Load current booking
        const { data: booking, error: fetchError } = await supabase
            .from("bookings")
            .select("id, status, booking_date, start_time, hold_expires_at, created_at, basket_id, court_id, open_play_session_id")
            .eq("id", bookingId)
            .maybeSingle();

        if (fetchError) {
            console.error("Status update: fetch error:", fetchError);
            return Response.json({ error: "Failed to load booking." }, { status: 500 });
        }
        if (!booking) {
            return Response.json({ error: "Booking not found." }, { status: 404 });
        }

        if (booking.open_play_session_id && booking.court_id) {
            return Response.json(
                { error: "This court is reserved for open play. Cancel the session from Open Play." },
                { status: 409 }
            );
        }

        const currentStatus = booking.status.toLowerCase();

        // 4. Validate transition
        if (!canTransition(currentStatus, newStatus)) {
            return Response.json(
                { error: `Cannot transition from "${currentStatus}" to "${newStatus}".` },
                { status: 409 }
            );
        }

        const blocked = gameDayBlockReason(newStatus, booking);
        if (blocked) {
            return Response.json({ error: `This booking is for ${booking.booking_date}. ${blocked}` }, { status: 409 });
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

            try {
                if ((await closeSiblingSessions(siblings)) === "paid") {
                    return Response.json(
                        { error: "The customer has already paid for this booking. Refresh to see its confirmed status." },
                        { status: 409 }
                    );
                }
            } catch (stripeErr) {
                console.error("Admin cancel: failed to expire Stripe session:", stripeErr);
                return Response.json(
                    { error: "Could not close the customer's payment session. Please try again." },
                    { status: 502 }
                );
            }
        }

        if (keepPayment) {
            const { data: paid, error: paidError } = await supabase
                .from("payments")
                .select("id")
                .eq("booking_id", bookingId)
                .eq("status", "paid")
                .limit(1);
            if (paidError) {
                console.error("Admin cancel: failed to check payment:", paidError);
                return Response.json({ error: "Could not verify the payment for this booking." }, { status: 500 });
            }
            if (!paid?.length) {
                return Response.json({ error: "This booking has no payment to keep. Cancel it without that option." }, { status: 409 });
            }
        }

        // 7. Conditional update (optimistic lock on current status) with Stage 2 audit timestamps
        const updatePayload = buildStatusUpdate(newStatus, booking);
        if (keepPayment) Object.assign(updatePayload, { cancel_reason: "payment_kept", cancel_note: cancelNote });

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

        // The rest of the unpaid basket; pending payments are marked failed
        await cancelRestOfBasket(supabase, booking.id, siblings, (s) => buildStatusUpdate("cancelled", s));

        return Response.json({ booking: updated });
    } catch (error) {
        console.error("Status update error:", error);
        return Response.json({ error: "Unexpected error." }, { status: 500 });
    }
}
