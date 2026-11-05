import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AUTH_LIMITS, checkRateLimit, clientIp, tooManyRequests } from "@/lib/rateLimit";

/**
 * Sends the sign-up confirmation email again, for players whose first one never arrived.
 * Rate limited per email and per IP; never reveals whether an account exists.
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => null);
        const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
        if (!email || email.length > 320) {
            return NextResponse.json({ error: "Email is required." }, { status: 400 });
        }

        const ip = await checkRateLimit(`confirm:ip:${clientIp(request)}`, AUTH_LIMITS.confirmResendsPerIp);
        if (!ip.allowed) return tooManyRequests("confirmation emails", ip.retryAfterSeconds);
        const perEmail = await checkRateLimit(`confirm:email:${email}`, AUTH_LIMITS.confirmResendsPerEmail);
        if (!perEmail.allowed) return tooManyRequests("confirmation emails", perEmail.retryAfterSeconds);

        const supabase = await createClient();
        const { error } = await supabase.auth.resend({
            type: "signup",
            email,
            // Same landing as the first email (api/auth/register)
            options: { emailRedirectTo: `${request.nextUrl.origin}/login?confirmed=true` },
        });
        if (error?.status === 429) {
            return NextResponse.json({ error: "Too many confirmation emails. Please wait a few minutes and try again." }, { status: 429 });
        }
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Resend-confirmation route error:", error);
        return NextResponse.json({ error: "Unable to send the confirmation email. Please try again." }, { status: 500 });
    }
}
