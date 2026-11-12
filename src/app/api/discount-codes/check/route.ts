import { NextRequest } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import { normaliseCode } from "@/lib/services/pricing/discounts";
import { AUTH_LIMITS, checkRateLimit, clientIp, tooManyRequests } from "@/lib/rateLimit";

/**
 * POST { code, amounts: number[] } → { valid, reason?, discount? } for the checkout's Apply button.
 * Only a preview: hold_court_basket checks the code again when the courts are held. Rate limited so codes
 * can't be guessed; the database function is only callable by the service role.
 */
export async function POST(request: NextRequest) {
    const limit = await checkRateLimit(`discount-check:ip:${clientIp(request)}`, AUTH_LIMITS.discountChecksPerIp);
    if (!limit.allowed) return tooManyRequests("code checks from this network", limit.retryAfterSeconds);

    const body = await request.json().catch(() => null);
    const code = normaliseCode(body?.code);
    const amounts: unknown = body?.amounts;
    if (!Array.isArray(amounts) || amounts.length === 0 || amounts.length > 50 || amounts.some((a) => typeof a !== "number" || !(a > 0))) {
        return Response.json({ error: "Missing booking details." }, { status: 400 });
    }
    if (!code) return Response.json({ valid: false, reason: "There is no such code." });

    const admin = getServiceClient();
    if (!admin) return Response.json({ error: "Discount codes are not available right now." }, { status: 503 });
    const { data, error } = await admin.rpc("check_discount_code", { p_code: code, p_amounts: amounts });
    if (error) {
        console.error("check_discount_code failed:", error);
        return Response.json({ error: "Could not check the code. Please try again." }, { status: 500 });
    }
    return Response.json(data);
}
