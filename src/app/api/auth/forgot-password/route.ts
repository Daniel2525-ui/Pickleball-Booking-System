import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AUTH_LIMITS, checkRateLimit, clientIp, tooManyRequests } from "@/lib/rateLimit";

/**
 * Sends the password-reset email through the server so it is rate limited per email and per IP.
 * The PKCE verifier cookie is set on this response, so the link must be opened in the same browser (as before).
 * Never reveals whether an account exists.
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => null);
        const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
        if (!email || email.length > 320) {
            return NextResponse.json({ error: "Email is required." }, { status: 400 });
        }

        const ip = await checkRateLimit(`reset:ip:${clientIp(request)}`, AUTH_LIMITS.resetsPerIp);
        if (!ip.allowed) return tooManyRequests("reset requests", ip.retryAfterSeconds);
        const perEmail = await checkRateLimit(`reset:email:${email}`, AUTH_LIMITS.resetsPerEmail);
        if (!perEmail.allowed) return tooManyRequests("reset requests", perEmail.retryAfterSeconds);

        const supabase = await createClient();
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: `${request.nextUrl.origin}/reset-password`,
        });
        if (error?.status === 429) {
            return NextResponse.json({ error: "Too many reset requests. Please wait a few minutes and try again." }, { status: 429 });
        }
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Forgot-password route error:", error);
        return NextResponse.json({ error: "Unable to send the reset email. Please try again." }, { status: 500 });
    }
}
