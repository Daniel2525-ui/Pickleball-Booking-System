import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";

/**
 * Limits for the /api/auth routes. Per-IP limits are generous because many players share one public IP
 * on the venue's Wi-Fi or mobile carrier NAT; the per-email limits do the real work against password guessing.
 */
export const AUTH_LIMITS = {
    loginFailuresPerEmail: { limit: 5, windowSeconds: 15 * 60 },
    loginAttemptsPerIp: { limit: 50, windowSeconds: 15 * 60 },
    signupsPerIp: { limit: 10, windowSeconds: 60 * 60 },
    resetsPerEmail: { limit: 3, windowSeconds: 60 * 60 },
    resetsPerIp: { limit: 10, windowSeconds: 60 * 60 },
} as const;

export interface RateLimitResult {
    allowed: boolean;
    retryAfterSeconds: number;
}

/** Client IP as set by Vercel's edge (x-forwarded-for's first entry), or "unknown" in local dev. */
export const clientIp = (request: NextRequest) =>
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";

/**
 * Counts (or, with increment = false, only reads) one attempt against a fixed window shared by every
 * instance via public.check_rate_limit. Fails open if the limiter itself is unavailable: an outage of the
 * limiter must not lock every player out; Supabase Auth's own rate limits still apply behind it.
 */
export async function checkRateLimit(
    key: string,
    { limit, windowSeconds }: { limit: number; windowSeconds: number },
    increment = true
): Promise<RateLimitResult> {
    const admin = getServiceClient();
    if (!admin) {
        console.error("Rate limiter: SUPABASE_SERVICE_ROLE_KEY missing; allowing request");
        return { allowed: true, retryAfterSeconds: 0 };
    }
    const { data, error } = await admin.rpc("check_rate_limit", {
        p_key: key,
        p_limit: limit,
        p_window_seconds: windowSeconds,
        p_increment: increment,
    });
    if (error || !data) {
        console.error("Rate limiter unavailable; allowing request:", error);
        return { allowed: true, retryAfterSeconds: 0 };
    }
    return { allowed: Boolean(data.allowed), retryAfterSeconds: Number(data.retry_after_seconds) || 0 };
}

/** Forgets a key, e.g. failed-login counts after a successful sign-in. */
export async function clearRateLimit(key: string) {
    await getServiceClient()?.from("auth_rate_limits").delete().eq("key", key);
}

/** 429 response with a human wait time and a Retry-After header. */
export const tooManyRequests = (action: string, retryAfterSeconds: number) => {
    const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
    return NextResponse.json(
        { error: `Too many ${action}. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`, retryAfterSeconds },
        { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
    );
};
