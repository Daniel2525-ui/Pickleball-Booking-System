import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe";

/** Valid transitions staff may trigger. No-show requires grace period. */
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
    pending: ["cancelled"],
    confirmed: ["checked_in", "no_show", "completed", "cancelled"],
    checked_in: ["in_progress", "completed", "cancelled"],
    in_progress: ["completed", "cancelled"],
};

const NO_SHOW_GRACE_MINUTES = 15;

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
            .select("id, status, booking_date, start_time")
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
        const allowedNext = ALLOWED_TRANSITIONS[currentStatus] ?? [];
        if (!allowedNext.includes(newStatus)) {
            return Response.json(
                { error: `Cannot transition from "${currentStatus}" to "${newStatus}".` },
                { status: 409 }
            );
        }

        // 5. No-show grace period guard
        if (newStatus === "no_show") {
            const venueOffset = "+08:00";
            const time = booking.start_time.length === 5
                ? `${booking.start_time}:00`
                : booking.start_time.slice(0, 8);
            const bookingStart = new Date(`${booking.booking_date}T${time}${venueOffset}`);
            const graceCutoff = new Date(bookingStart.getTime() + NO_SHOW_GRACE_MINUTES * 60_000);

            if (new Date() < graceCutoff) {
                const minutesLeft = Math.ceil((graceCutoff.getTime() - Date.now()) / 60_000);
                return Response.json(
                    { error: `No-show grace period has not elapsed. ${minutesLeft} minute(s) remaining.` },
                    { status: 409 }
                );
            }
        }

        // 6. Conditional update (optimistic lock on current status) with Stage 2 audit timestamps
        const now = new Date().toISOString();
        const updatePayload: Record<string, unknown> = {
            status: newStatus,
        };

        if (newStatus === "checked_in") updatePayload.checked_in_at = now;
        if (newStatus === "in_progress") updatePayload.started_at = now;
        if (newStatus === "completed") updatePayload.completed_at = now;
        if (newStatus === "no_show") updatePayload.no_show_at = now;

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

        if (newStatus === "cancelled") {
            const { data: payment } = await supabase
                .from("payments")
                .select("id, status, stripe_session_id")
                .eq("booking_id", bookingId)
                .maybeSingle();

            if (payment?.stripe_session_id) {
                try {
                    const session = await stripe.checkout.sessions.retrieve(payment.stripe_session_id);
                    if (session.status === "open") {
                        await stripe.checkout.sessions.expire(payment.stripe_session_id);
                    }
                } catch (stripeErr) {
                    console.error("Admin cancel: failed to expire Stripe session:", stripeErr);
                }
            }

            if (payment?.status === "pending") {
                await supabase
                    .from("payments")
                    .update({ status: "failed" })
                    .eq("id", payment.id)
                    .eq("status", "pending");
            }
        }

        return Response.json({ booking: updated });
    } catch (error) {
        console.error("Status update error:", error);
        return Response.json({ error: "Unexpected error." }, { status: 500 });
    }
}
