export interface SpotRow {
    open_play_session_id: string;
    open_play_spots: number | null;
    status: string;
    hold_expires_at: string | null;
}

/** Spots booked per session (same rule as open_play_spots_taken). */
export function tallySpots(rows: SpotRow[], now: Date = new Date()) {
    const booked = new Map<string, number>();
    for (const r of rows) {
        // shortcut: a pending hold counts until hold_expires_at, ignoring the short release grace period; fine for a staff overview
        if (r.status === "pending" && r.hold_expires_at && new Date(r.hold_expires_at) < now) continue;
        booked.set(r.open_play_session_id, (booked.get(r.open_play_session_id) ?? 0) + (r.open_play_spots ?? 0));
    }
    return { booked };
}

export interface PastSpotRow {
    open_play_session_id: string;
    open_play_spots: number | null;
    status: string;
    payments: { status: string; amount: number | string | null }[] | null;
}

/** Per past session: spots that went ahead, spots played, and money still held (a kept payment counts; refunds don't). */
export function summarizePastSessions(rows: PastSpotRow[]) {
    const out = new Map<string, { booked: number; played: number; collected: number }>();
    for (const r of rows) {
        const s = out.get(r.open_play_session_id) ?? { booked: 0, played: 0, collected: 0 };
        const spots = r.open_play_spots ?? 0;
        if (["confirmed", "checked_in", "in_progress", "completed", "no_show"].includes(r.status)) s.booked += spots;
        if (r.status === "completed") s.played += spots;
        s.collected += (r.payments ?? []).filter((p) => p.status === "paid").reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
        out.set(r.open_play_session_id, s);
    }
    return out;
}

export function parseSpotRequest(body: unknown): { sessionId: string; spots: number; method: "stripe" } | { error: string } {
    const b = (body ?? {}) as Record<string, unknown>;
    const sessionId = typeof b.sessionId === "string" ? b.sessionId.trim() : "";
    if (!sessionId) return { error: "Missing session." };
    if (typeof b.spots !== "number" || !Number.isInteger(b.spots) || b.spots < 1 || b.spots > 30) {
        // The venue's per-player limit is checked in hold_open_play_spots; 30 is the setting's ceiling
        return { error: "Choose how many spots you need." };
    }
    const method = b.payment_method ?? "stripe";
    if (method !== "stripe") return { error: "Invalid payment method." };
    return { sessionId, spots: b.spots, method };
}

/** Maps the shared session-capacity SQL errors to a 409 body; null when the message is not one of them. */
export function sessionErrorResponse(message: string | undefined): { error: string } | null {
    const msg = message ?? "";
    if (msg.includes("VENUE_CLOSED")) return { error: "The venue is closed on this date." };
    if (msg.includes("SESSION_FULL")) return { error: "This session is full." };
    if (msg.includes("PLAYER_LIMIT")) return { error: "That is more spots than one player can book in this session." };
    if (msg.includes("SESSION_UNAVAILABLE") || msg.includes("NOT_FOUND")) return { error: "This session is no longer available." };
    if (msg.includes("OPEN_HOLD_EXISTS")) return { error: "You already have spots awaiting payment in this session. Resume or cancel them in My Bookings." };
    return null;
}
