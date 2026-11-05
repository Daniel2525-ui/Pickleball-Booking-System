export type GameDayStatus = "checked_in" | "in_progress" | "completed" | "no_show" | "cancelled";

export const updateBookingStatus = async (
    bookingId: string,
    status: GameDayStatus,
    /** Cancelling a paid booking: keep the payment instead of owing a refund, with the reason */
    keep?: { note: string }
): Promise<{ error: string | null }> => {
    try {
        const res = await fetch("/api/admin/bookings/status", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ bookingId, status, ...(keep && { keepPayment: true, note: keep.note }) }),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) return { error: body?.error || "Failed to update status." };
        return { error: null };
    } catch {
        return { error: "Network error. Please check your connection." };
    }
};
