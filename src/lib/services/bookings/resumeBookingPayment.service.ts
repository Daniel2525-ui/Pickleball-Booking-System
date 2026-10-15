/**
 * Calls the secure backend endpoint to resume payment on an existing pending booking.
 */
export const resumeBookingPayment = async (
    bookingId: string
): Promise<{ url: string | null; error: Error | null }> => {
    try {
        const res = await fetch("/api/bookings/resume-payment", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ bookingId }),
        });

        const body = await res.json().catch(() => null);

        if (!res.ok || !body?.url) {
            return {
                url: null,
                error: new Error(body?.error || "Failed to resume payment. Please try again."),
            };
        }

        return { url: body.url, error: null };
    } catch (error) {
        console.error("Failed to resume payment:", error);
        return {
            url: null,
            error: new Error("Network error while connecting to payment provider. Please check your connection and try again."),
        };
    }
};
