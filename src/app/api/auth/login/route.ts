import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AUTH_LIMITS, checkRateLimit, clearRateLimit, clientIp, tooManyRequests } from "@/lib/rateLimit";

/** Password sign-in through the server so attempts are rate limited; sets the same session cookies as before. */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => null);
        const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
        const password = typeof body?.password === "string" ? body.password : "";
        if (!email || !password || email.length > 320) {
            return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
        }

        const ip = await checkRateLimit(`login:ip:${clientIp(request)}`, AUTH_LIMITS.loginAttemptsPerIp);
        if (!ip.allowed) return tooManyRequests("sign-in attempts", ip.retryAfterSeconds);
        const failKey = `login:fail:${email}`;
        const failures = await checkRateLimit(failKey, AUTH_LIMITS.loginFailuresPerEmail, false);
        if (!failures.allowed) return tooManyRequests("failed sign-in attempts for this account", failures.retryAfterSeconds);

        const supabase = await createClient();
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        // Right password, unconfirmed email: say so, and don't count it as a failed guess
        if (error?.code === "email_not_confirmed") {
            return NextResponse.json(
                { error: "Please confirm your email first. Check your inbox (and spam) for the email from Crosshair Dinkers.", code: "email_not_confirmed" },
                { status: 403 }
            );
        }
        if (error || !data.user) {
            await checkRateLimit(failKey, AUTH_LIMITS.loginFailuresPerEmail);
            return NextResponse.json({ error: "Invalid email or password. Please try again." }, { status: 401 });
        }
        await clearRateLimit(failKey);

        const { data: profile, error: profileError } = await supabase.from("profiles").select("role").eq("id", data.user.id).maybeSingle();
        if (profileError || !profile?.role) {
            return NextResponse.json({ error: "Unable to retrieve user profile." }, { status: 500 });
        }
        return NextResponse.json({ role: profile.role });
    } catch (error) {
        console.error("Login route error:", error);
        return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
    }
}
