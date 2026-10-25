export type GameDayStatus = "checked_in" | "in_progress" | "completed" | "no_show" | "cancelled";

export const updateBookingStatus = async (
    bookingId: string,
    status: GameDayStatus
): Promise<{ error: string | null }> => {
    try {
        const res = await fetch("/api/admin/bookings/status", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ bookingId, status }),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) return { error: body?.error || "Failed to update status." };
        return { error: null };
    } catch {
        return { error: "Network error. Please check your connection." };
    }
};
