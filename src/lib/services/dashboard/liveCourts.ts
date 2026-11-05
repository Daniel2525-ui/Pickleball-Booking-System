import { courtNowNext } from "../courts/courtDay.ts";
import { getBookingEnd, getBookingStart } from "../../utils/bookingTime.ts";

/** A booking holding a court today, with its payments (what the live card needs). */
export interface LiveSlot {
    id: string;
    court_id: string | null;
    booking_date: string;
    start_time: string;
    end_time: string;
    status: string;
    hold_expires_at?: string | null;
    total_amount: number | string;
    open_play_session_id: string | null;
    customer_name: string | null;
    profiles: { full_name: string } | null;
    customers: { full_name: string } | null;
    payments: { status: string; amount: number | string; payment_method: string | null }[] | null;
}

export type LiveState = "in_play" | "free" | "open_play" | "maintenance" | "closed";

export interface LiveCourtTile {
    name: string;
    state: LiveState;
    note: string | null;
    who: string | null;
    slot: { start: string; end: string } | null;
    minutesLeft: number | null;
    /** Share of the slot already played, 0..1 */
    progress: number | null;
    payment: { paid: boolean; label: string } | null;
    spots: { booked: number; capacity: number } | null;
    sessionId: string | null;
    freeUntil: string | null;
    next: { name: string; start: string } | null;
}

const METHODS: Record<string, string> = { cash: "Cash", gcash: "GCash" };
const hhmm = (t: string) => t.slice(0, 5);

/** The name staff use for a booking: walk-ins are marked, open play is just "Open play". */
export const liveName = (s: LiveSlot) =>
    s.open_play_session_id ? "Open play"
    : s.customers && !s.profiles ? `Walk-in · ${s.customer_name || s.customers.full_name}`
    : s.customer_name || s.profiles?.full_name || "Guest Player";

function paymentLine(s: LiveSlot): LiveCourtTile["payment"] {
    if (s.open_play_session_id) return null;
    const paid = (s.payments ?? []).find((p) => p.status === "paid");
    if (paid) return { paid: true, label: `Paid · ${METHODS[paid.payment_method ?? ""] ?? "Card"}` };
    if (s.status === "pending" && s.hold_expires_at === "infinity") return { paid: false, label: "GCash · waiting for your check" };
    const owed = (s.payments ?? []).filter((p) => p.status === "pending").reduce((sum, p) => sum + Number(p.amount || 0), 0) || Number(s.total_amount || 0);
    return { paid: false, label: `Unpaid · collect ₱${owed.toLocaleString("en-PH")}` };
}

/** What one court's tile shows at `now`, from today's bookings on any court. */
export function liveCourtTile(
    court: { id: string; name: string; status: string | null; maintenance_note?: string | null },
    slots: LiveSlot[],
    now: Date,
    sessions: Record<string, { booked: number; capacity: number }> = {},
): LiveCourtTile {
    const base: LiveCourtTile = {
        name: court.name, state: "free", note: null, who: null, slot: null, minutesLeft: null, progress: null,
        payment: null, spots: null, sessionId: null, freeUntil: null, next: null,
    };
    const status = (court.status ?? "").toLowerCase();
    if (status === "maintenance" || status === "closed") return { ...base, state: status, note: court.maintenance_note ?? null };

    const { current, next } = courtNowNext(slots, court.id, now);
    const upNext = next ? { name: liveName(next), start: hhmm(next.start_time) } : null;
    if (!current) return { ...base, freeUntil: upNext?.start ?? null, next: upNext };

    const start = getBookingStart(current).getTime();
    const end = getBookingEnd(current).getTime();
    return {
        ...base,
        state: current.open_play_session_id ? "open_play" : "in_play",
        who: liveName(current),
        slot: { start: hhmm(current.start_time), end: hhmm(current.end_time) },
        minutesLeft: Math.max(0, Math.ceil((end - now.getTime()) / 60_000)),
        progress: Math.min(1, Math.max(0, (now.getTime() - start) / (end - start))),
        payment: paymentLine(current),
        spots: current.open_play_session_id ? sessions[current.open_play_session_id] ?? null : null,
        sessionId: current.open_play_session_id,
        next: upNext,
    };
}
