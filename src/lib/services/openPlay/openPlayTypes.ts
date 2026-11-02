export function parseSpotRequest(body: unknown): { sessionId: string; spots: number; method: "stripe" | "gcash" } | { error: string } {
    const b = (body ?? {}) as Record<string, unknown>;
    const sessionId = typeof b.sessionId === "string" ? b.sessionId.trim() : "";
    if (!sessionId) return { error: "Missing session." };
    if (typeof b.spots !== "number" || !Number.isInteger(b.spots) || b.spots < 1 || b.spots > 4) {
        return { error: "Choose 1 to 4 spots." };
    }
    const method = b.payment_method ?? "stripe";
    if (method !== "stripe" && method !== "gcash") return { error: "Invalid payment method." };
    return { sessionId, spots: b.spots, method };
}

/** Maps the shared session-capacity SQL errors to a 409 body; null when the message is not one of them. */
export function sessionErrorResponse(message: string | undefined): { error: string } | null {
    const msg = message ?? "";
    if (msg.includes("SESSION_FULL")) return { error: "This session is full." };
    if (msg.includes("PLAYER_LIMIT")) return { error: "You can book at most 4 spots in one session." };
    if (msg.includes("SESSION_UNAVAILABLE") || msg.includes("NOT_FOUND")) return { error: "This session is no longer available." };
    if (msg.includes("OPEN_HOLD_EXISTS")) return { error: "You already have spots awaiting payment in this session. Resume or cancel them in My Bookings." };
    return null;
}
