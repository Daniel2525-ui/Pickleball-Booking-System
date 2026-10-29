import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe";
import { sameCentavo } from "@/lib/services/bookings/basketSiblings";

export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient();

        // 1. Authenticate caller
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
        }

        const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
        if (profile?.role !== "admin") return NextResponse.json({ error: "Admin access required." }, { status: 403 });

        // 2. Validate request payload
        const body = await request.json().catch(() => null);
        const paymentId = typeof body?.paymentId === "string" ? body.paymentId.trim() : "";
        const bookingId = typeof body?.bookingId === "string" ? body.bookingId.trim() : "";
        const paymentMethod = typeof body?.paymentMethod === "string" ? body.paymentMethod.trim().toLowerCase() : "";
        const paymentReference = typeof body?.paymentReference === "string" ? body.paymentReference.trim() : null;

        if (!paymentId || !bookingId || (paymentMethod !== "cash" && paymentMethod !== "gcash")) {
            return NextResponse.json(
                { error: "paymentId, bookingId, and a valid paymentMethod ('cash' or 'gcash') are required." },
                { status: 400 }
            );
        }

        if (paymentMethod === "gcash" && !paymentReference) {
            return NextResponse.json(
                { error: "paymentReference is required for GCash payments." },
                { status: 400 }
            );
        }

        // 3. Close any open Stripe Checkout first, otherwise the customer could still pay online
        //    and be charged twice for a booking settled at the counter.
        const { data: payment, error: paymentError } = await supabase
            .from("payments")
            .select("stripe_session_id, bookings(basket_id, status)")
            .eq("id", paymentId)
            .eq("booking_id", bookingId)
            .maybeSingle();

        if (paymentError) {
            console.error("Counter settlement: failed to load payment:", paymentError);
            return NextResponse.json({ error: "Could not load the payment. Please try again." }, { status: 500 });
        }

        // An unpaid basket is settled as one unit; the basket id comes from the DB row, never the client
        const owner = payment?.bookings as { basket_id?: string | null; status?: string } | null | undefined;
        const basketId = owner?.basket_id && owner.status === "pending" ? owner.basket_id : null;

        // Staff must collect exactly what the basket RPC records: refuse when the total they saw differs
        // (e.g. the admin list was filtered and hid a court). Checked before any Stripe or DB write.
        if (basketId) {
            const expectedAmount = body?.expectedAmount;
            if (typeof expectedAmount !== "number" || !Number.isFinite(expectedAmount) || expectedAmount <= 0) {
                return NextResponse.json({ error: "expectedAmount must be the positive amount shown to staff." }, { status: 400 });
            }
            const { data: due, error: dueError } = await supabase
                .from("payments")
                .select("amount, bookings!inner(basket_id, status)")
                .eq("status", "pending")
                .eq("bookings.basket_id", basketId)
                .eq("bookings.status", "pending");
            if (dueError) {
                console.error("Counter settlement: failed to load basket total:", dueError);
                return NextResponse.json({ error: "Could not load the payment. Please try again." }, { status: 500 });
            }
            const basketTotal = (due ?? []).reduce((sum, p) => sum + Number(p.amount), 0);
            if (!sameCentavo(basketTotal, expectedAmount)) {
                return NextResponse.json({ error: "This booking has more courts than shown. Refresh and try again." }, { status: 409 });
            }
        }

        if (payment?.stripe_session_id) {
            try {
                const session = await stripe.checkout.sessions.retrieve(payment.stripe_session_id);
                if (session.status === "complete") {
                    return NextResponse.json(
                        { error: "The customer has already paid online for this booking. Refresh to see the confirmed booking." },
                        { status: 409 }
                    );
                }
                if (session.status === "open") {
                    await stripe.checkout.sessions.expire(payment.stripe_session_id);
                }
            } catch (stripeError) {
                console.error("Counter settlement: failed to close Stripe session:", stripeError);
                return NextResponse.json(
                    { error: "Could not close the customer's online payment session. Please try again." },
                    { status: 502 }
                );
            }
        }

        // 4. Execute atomic counter settlement via database RPC. An unpaid basket is settled as one unit
        //    (all-or-nothing); its courts share the session closed above. The basket id comes from the DB row.
        const { data: settleRes, error: settleErr } =
            basketId
                ? await supabase.rpc("settle_counter_basket", {
                      p_basket_id: basketId,
                      p_payment_method: paymentMethod,
                      p_payment_reference: paymentReference,
                  })
                : await supabase.rpc("settle_counter_payment", {
                      p_booking_id: bookingId,
                      p_payment_id: paymentId,
                      p_payment_method: paymentMethod,
                      p_payment_reference: paymentReference,
                  });

        if (settleErr) {
            console.error("Counter settlement RPC error:", settleErr);
            if (settleErr.message?.includes("FORBIDDEN")) {
                return NextResponse.json({ error: "Admin access required." }, { status: 403 });
            }
            if (settleErr.message?.includes("HOLD_EXPIRED")) {
                return NextResponse.json(
                    { error: "This online hold has expired. Record a new walk-in reservation to take payment at the counter." },
                    { status: 409 }
                );
            }
            if (
                settleErr.message?.includes("INVALID_STATUS") ||
                settleErr.message?.includes("SLOT_UNAVAILABLE") ||
                settleErr.message?.includes("MATCH_START_PASSED")
            ) {
                return NextResponse.json({ error: settleErr.message }, { status: 409 });
            }
            return NextResponse.json({ error: settleErr.message || "Settlement failed." }, { status: 500 });
        }

        return NextResponse.json({ success: true, data: settleRes });
    } catch (error) {
        console.error("Counter settlement error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
