export interface BookingStatusResult {
    id: string;
    status: string;
    hold_expires_at: string | null;
    cancel_reason: string | null;
}

/**
 * Client service to fetch authoritative booking status and hold expiry from the secure server endpoint.
 */
export const fetchBookingStatus = async (
    bookingId: string
): Promise<{ data: BookingStatusResult | null; error: Error | null }> => {
    try {
        const res = await fetch(`/api/bookings/status?bookingId=${encodeURIComponent(bookingId)}`, {
            method: "GET",
            headers: { "Content-Type": "application/json" },
        });

        if (!res.ok) {
            const body = await res.json().catch(() => null);
            return {
                data: null,
                error: new Error(body?.error || "Failed to retrieve booking status."),
            };
        }

        const data: BookingStatusResult = await res.json();
        return { data, error: null };
    } catch (err) {
        console.error("fetchBookingStatus error:", err);
        return {
            data: null,
            error: new Error("Network error while checking booking status."),
        };
    }
};
