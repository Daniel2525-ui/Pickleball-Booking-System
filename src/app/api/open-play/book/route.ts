import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { openBasketCheckout } from "@/lib/services/payments/openBasketCheckout";
import { parseSpotRequest, sessionErrorResponse } from "@/lib/services/openPlay/openPlayTypes";

export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
            return Response.json({ error: "You must be logged in to book a spot." }, { status: 401 });
        }

        const parsed = parseSpotRequest(await request.json().catch(() => null));
        if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });

        if (parsed.method === "gcash") {
            const { data: settings } = await supabase.from("booking_settings").select("gcash_number").maybeSingle();
            if (!settings?.gcash_number) {
                return Response.json({ error: "GCash payments are not available right now." }, { status: 400 });
            }
        } else if (!process.env.STRIPE_SECRET_KEY) {
            return Response.json({ error: "Stripe is not configured. Please contact the administrator." }, { status: 500 });
        }

        const { data: hold, error: rpcError } = await supabase.rpc("hold_open_play_spots", {
            p_session_id: parsed.sessionId,
            p_spots: parsed.spots,
            p_payment_method: parsed.method,
        });
        if (rpcError) {
            const mapped = sessionErrorResponse(rpcError.message);
            if (mapped) return Response.json(mapped, { status: 409 });
            if (rpcError.message?.includes("INVALID_ARGUMENT")) {
                return Response.json({ error: "Invalid booking details." }, { status: 400 });
            }
            console.error("hold_open_play_spots failed:", rpcError);
            return Response.json({ error: "Failed to reserve your spots. Please try again." }, { status: 500 });
        }

        if (parsed.method === "gcash") {
            return Response.json({ url: `/book/gcash?basket=${hold.basket_id}` });
        }

        // The hold result carries no time; read the held row (RLS lets the owner see it)
        const { data: row } = await supabase
            .from("bookings")
            .select("booking_date, start_time, end_time")
            .eq("id", hold.booking_id)
            .maybeSingle();
        if (!row) return Response.json({ error: "Could not create reservation hold. Please try again." }, { status: 500 });

        const { url, confirmError } = await openBasketCheckout({
            supabase,
            basketId: hold.basket_id,
            customerEmail: user.email,
            baseUrl: request.nextUrl.origin,
            lines: [
                {
                    bookingId: hold.booking_id,
                    paymentId: hold.payment_id,
                    courtName: `Open play (${parsed.spots} spot${parsed.spots === 1 ? "" : "s"})`,
                    bookingDate: row.booking_date,
                    startTime: row.start_time,
                    endTime: row.end_time,
                    amount: Number(hold.amount),
                },
            ],
        });
        if (confirmError) {
            const mapped = sessionErrorResponse(confirmError.message);
            if (mapped) return Response.json(mapped, { status: 409 });
            return Response.json(
                { error: "Unable to confirm your spot hold. If payment was initiated, your booking will be preserved under My Bookings." },
                { status: 500 }
            );
        }
        return Response.json({ url });
    } catch (error) {
        // Ambiguous failures keep the pending hold; cron cleanup or resume-payment resolves it
        console.error("Open play booking error:", error);
        return Response.json({ error: "An unexpected error occurred. Please try again." }, { status: 500 });
    }
}
