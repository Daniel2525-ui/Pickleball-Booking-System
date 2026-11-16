import type { NextRequest } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import { parseGuestDetails } from "@/lib/services/bookings/guestDetails";
import { AUTH_LIMITS, checkRateLimit, clientIp, tooManyRequests } from "@/lib/rateLimit";

/**
 * A guest pays on an anonymous session: their details go on a guest profile (the confirmation email's
 * address, and what the front desk sees). Returns the guest's email, or the error response to send.
 */
export const saveGuestProfile = async (request: NextRequest, userId: string, input: unknown): Promise<{ email: string } | Response> => {
    const limit = await checkRateLimit(`guest-checkout:ip:${clientIp(request)}`, AUTH_LIMITS.guestCheckoutsPerIp);
    if (!limit.allowed) return tooManyRequests("guest checkouts from this network", limit.retryAfterSeconds);
    const guest = parseGuestDetails(input);
    if (!guest.ok) return Response.json({ error: guest.error }, { status: 400 });
    const admin = getServiceClient();
    if (!admin) {
        console.error("Guest checkout needs SUPABASE_SERVICE_ROLE_KEY to save the guest's details");
        return Response.json({ error: "Guest checkout is not available right now. Please sign in to book." }, { status: 503 });
    }
    const { error } = await admin
        .from("profiles")
        .upsert({ id: userId, role: "customer", is_guest: true, ...guest.value }, { onConflict: "id" });
    if (error) {
        console.error("Guest profile save failed:", error);
        return Response.json({ error: "Could not save your details. Please try again." }, { status: 500 });
    }
    return { email: guest.value.email };
};
