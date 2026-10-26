import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/bookings/status?bookingId=<uuid>
 *
 * Secure server-side endpoint to check authoritative booking status and hold expiry.
 *
 * Security:
 * - Requires authenticated user session cookie.
 * - Enforces strict server-side ownership verification: booking.user_id === user.id (or admin).
 * - Does not rely on remote table RLS.
 * - Returns only non-sensitive status and hold metadata.
 */
export async function GET(req: NextRequest) {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
            return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        const bookingId = req.nextUrl.searchParams.get("bookingId")?.trim() || "";
        if (!bookingId) {
            return Response.json({ error: "Missing or invalid booking ID." }, { status: 400 });
        }

        // Fetch booking record
        const { data: booking, error: fetchError } = await supabase
            .from("bookings")
            .select("id, user_id, status, hold_expires_at")
            .eq("id", bookingId)
            .maybeSingle();

        if (fetchError) {
            console.error("Failed to load booking status:", fetchError);
            return Response.json({ error: "Failed to load booking status." }, { status: 500 });
        }

        if (!booking) {
            return Response.json({ error: "Booking not found." }, { status: 404 });
        }

        // Enforce ownership or admin privilege
        if (booking.user_id !== user.id) {
            const { data: profile } = await supabase
                .from("profiles")
                .select("role")
                .eq("id", user.id)
                .maybeSingle();

            if (profile?.role !== "admin") {
                // Return 404 to avoid leaking existence of other users' bookings
                return Response.json({ error: "Booking not found." }, { status: 404 });
            }
        }

        return Response.json({
            id: booking.id,
            status: booking.status,
            hold_expires_at: booking.hold_expires_at,
        });
    } catch (err) {
        console.error("Booking status API error:", err);
        return Response.json({ error: "An unexpected error occurred." }, { status: 500 });
    }
}
