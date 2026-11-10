import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireAdmin } from "@/lib/supabase/server";
import { qrExpiresAt, xendit, xenditEnabled, type XenditPaymentRequest } from "@/lib/xendit";
import { qrImage } from "@/lib/xenditQr";

// Demo: a QR Ph code the front desk shows a walk-in. Staff record the payment once Xendit reports it paid.
// shortcut: the paid QR is not tied to the booking on the server (staff are trusted); verify it in the settle RPCs before launch
export async function POST(request: NextRequest) {
    try {
        const { denied } = await requireAdmin();
        if (denied) return denied;
        if (!xenditEnabled()) return NextResponse.json({ error: "QR Ph is not set up." }, { status: 500 });

        const amount = Number((await request.json().catch(() => null))?.amount);
        // QR Ph accepts 1.00 to 50,000.00 per payment
        if (!Number.isFinite(amount) || amount < 1 || amount > 50000) {
            return NextResponse.json({ error: "The amount must be between ₱1 and ₱50,000." }, { status: 400 });
        }

        const pr = await xendit<XenditPaymentRequest>("/v3/payment_requests", {
            reference_id: `counter-${randomUUID()}`,
            type: "PAY",
            country: "PH",
            currency: "PHP",
            request_amount: Math.round(amount * 100) / 100,
            capture_method: "AUTOMATIC",
            channel_code: "QRPH",
            description: "Front desk payment",
        });
        return NextResponse.json({
            prId: pr.payment_request_id,
            src: await qrImage(pr),
            expiresAt: qrExpiresAt(pr),
            testMode: Boolean(process.env.XENDIT_SECRET_KEY?.startsWith("xnd_development_")),
        });
    } catch (error) {
        console.error("Counter QR error:", error);
        return NextResponse.json({ error: "Could not create the QR Ph code. Try again." }, { status: 502 });
    }
}
