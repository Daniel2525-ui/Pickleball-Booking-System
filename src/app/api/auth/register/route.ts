import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AUTH_LIMITS, checkRateLimit, clientIp, tooManyRequests } from "@/lib/rateLimit";

/** Account sign-up through the server so it is rate limited per IP. Same checks as the register form. */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => null);
        const email = typeof body?.email === "string" ? body.email.trim() : "";
        const password = typeof body?.password === "string" ? body.password : "";
        const fullName = typeof body?.fullName === "string" ? body.fullName.trim() : "";
        const phone = typeof body?.phone === "string" ? body.phone.replace(/\D/g, "") : "";

        if (!email || email.length > 320 || !fullName || fullName.length > 120) {
            return NextResponse.json({ error: "Full name and email are required." }, { status: 400 });
        }
        if (password.length < 6) {
            return NextResponse.json({ error: "Password is too short. Please choose a password with at least 6 characters." }, { status: 400 });
        }
        if (phone.length !== 11) {
            return NextResponse.json({ error: "Phone number must be exactly 11 digits." }, { status: 400 });
        }

        const limit = await checkRateLimit(`signup:ip:${clientIp(request)}`, AUTH_LIMITS.signupsPerIp);
        if (!limit.allowed) return tooManyRequests("sign-ups from this network", limit.retryAfterSeconds);

        const supabase = await createClient();

        // A guest who paid without an account keeps the same user (and so their bookings): the email goes on the
        // guest session. Supabase sets a password only once that email is confirmed: at once with "Confirm email"
        // off, otherwise the emailed link opens the choose-a-password page.
        const { data: { user: current } } = await supabase.auth.getUser();
        if (current?.is_anonymous) {
            const { data: linked, error: linkError } = await supabase.auth.updateUser(
                { email, data: { full_name: fullName, phone } },
                { emailRedirectTo: `${request.nextUrl.origin}/reset-password` }
            );
            if (linkError) {
                // Supabase says when the email already has an account; a neutral message keeps that private
                if (linkError.status === 429) return NextResponse.json({ error: linkError.message }, { status: 429 });
                console.error("Guest account conversion failed:", linkError.message);
                return NextResponse.json({ error: "We couldn't use that email. If you already have an account, sign in instead." }, { status: 400 });
            }
            if (linked.user?.email?.toLowerCase() !== email.toLowerCase()) {
                return NextResponse.json({ success: true, signedIn: false, confirmEmail: true });
            }
            const { error: passwordError } = await supabase.auth.updateUser({ password });
            if (passwordError) return NextResponse.json({ error: passwordError.message }, { status: 400 });
            return NextResponse.json({ success: true, signedIn: true });
        }

        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            // Must be in Supabase Auth > URL Configuration > Redirect URLs, or Supabase falls back to the Site URL
            options: { data: { full_name: fullName, phone }, emailRedirectTo: `${request.nextUrl.origin}/login?confirmed=true` },
        });
        if (error) return NextResponse.json({ error: error.message }, { status: error.status === 429 ? 429 : 400 });

        // With "Confirm email" off, Supabase signs the player in right away
        return NextResponse.json({ success: true, signedIn: !!data.session });
    } catch (error) {
        console.error("Register route error:", error);
        return NextResponse.json({ error: "Unable to complete registration. Please try again." }, { status: 500 });
    }
}
