import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient();

        // 1. Authenticate caller
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
        }

        // 2. Authorize admin role
        const { data: profile } = await supabase
            .from("profiles")
            .select("role")
            .eq("id", user.id)
            .maybeSingle();

        if (profile?.role !== "admin") {
            return NextResponse.json({ error: "Admin access required." }, { status: 403 });
        }

        // 3. Validate request payload
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

        // 4. Update payment row to paid
        const { data: updatedPayment, error: paymentError } = await supabase
            .from("payments")
            .update({
                status: "paid",
                payment_method: paymentMethod,
                payment_reference: paymentReference || null,
                paid_at: new Date().toISOString(),
            })
            .eq("id", paymentId)
            .eq("booking_id", bookingId)
            .eq("status", "pending")
            .select()
            .maybeSingle();

        if (paymentError) {
            console.error("Counter settlement: payment update failed:", paymentError);
            return NextResponse.json({ error: "Failed to update payment record." }, { status: 500 });
        }

        if (!updatedPayment) {
            return NextResponse.json(
                { error: "Payment is no longer pending or has already been settled." },
                { status: 409 }
            );
        }

        // 5. Confirm booking so it is protected from cleanup cron
        const { error: bookingError } = await supabase
            .from("bookings")
            .update({ status: "confirmed" })
            .eq("id", bookingId)
            .eq("status", "pending");

        if (bookingError) {
            console.error("Counter settlement: booking confirmation failed:", bookingError);
        }

        return NextResponse.json({ success: true, data: updatedPayment });
    } catch (error) {
        console.error("Counter settlement error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
